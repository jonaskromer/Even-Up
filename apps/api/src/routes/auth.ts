import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { verifyToken } from '../services/authService.js';
import {
  supabaseSignIn,
  supabaseSignUp,
  supabaseRefresh,
  supabaseExchangePKCE,
  supabaseResetPassword,
} from '../lib/supabaseAuth.js';
import { generateVerifier, generateChallenge, buildOAuthUrl } from '../lib/pkce.js';
import { setAuthCookies, clearAuthCookies } from '../lib/cookies.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/HttpError.js';
import { env } from '../env.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6),
  lang: z.enum(['de', 'en']).optional(),
});
const exchangeSchema = z.object({ access_token: z.string(), refresh_token: z.string() });

const SECURE_COOKIE = !!env.CORS_ORIGIN;

export async function authRoutes(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req: FastifyRequest) => req.ip,
  });

  // ── Session check ──────────────────────────────────────────────────────────
  app.get(
    '/me',
    { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => ({ user: req.user }),
  );

  // ── Email/password login ────────────────────────────────────────────────────
  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password } = loginSchema.parse(req.body);
      let tokens;
      try {
        tokens = await supabaseSignIn(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, email, password);
      } catch (err) {
        throw new HttpError(401, err instanceof Error ? err.message : 'Login fehlgeschlagen');
      }
      setAuthCookies(reply, tokens.access_token, tokens.refresh_token);
      return reply.send({ ok: true });
    },
  );

  // ── Registration ────────────────────────────────────────────────────────────
  app.post(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { name, email, password, lang } = registerSchema.parse(req.body);
      let result;
      try {
        result = await supabaseSignUp(
          env.SUPABASE_URL,
          env.SUPABASE_ANON_KEY,
          email,
          password,
          name,
          lang,
        );
      } catch (err) {
        throw new HttpError(
          422,
          err instanceof Error ? err.message : 'Registrierung fehlgeschlagen',
        );
      }

      if (!result.session) {
        // Email confirmation required — no session yet
        return reply.send({ needsEmailConfirmation: true });
      }

      setAuthCookies(reply, result.session.access_token, result.session.refresh_token);
      return reply.send({ needsEmailConfirmation: false });
    },
  );

  // ── Logout ──────────────────────────────────────────────────────────────────
  app.post(
    '/logout',
    { preHandler: [requireAuth], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      clearAuthCookies(reply);
      return reply.status(204).send();
    },
  );

  // ── Token refresh ───────────────────────────────────────────────────────────
  app.post(
    '/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const refreshToken = req.cookies?.sb_refresh;
      if (!refreshToken) throw new HttpError(401, 'Kein Refresh-Token');
      let tokens;
      try {
        tokens = await supabaseRefresh(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, refreshToken);
      } catch {
        clearAuthCookies(reply);
        throw new HttpError(401, 'Session abgelaufen');
      }
      setAuthCookies(reply, tokens.access_token, tokens.refresh_token);
      return reply.send({ ok: true });
    },
  );

  // ── OAuth exchange (passkeys / client-side OAuth fallback) ──────────────────
  // After a client-side auth flow (passkeys) the browser sends us the short-lived
  // access + refresh tokens, we verify them and set HttpOnly cookies in return.
  app.post(
    '/exchange',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { access_token, refresh_token } = exchangeSchema.parse(req.body);
      try {
        await verifyToken(access_token);
      } catch {
        throw new HttpError(401, 'Ungültiger Token');
      }
      setAuthCookies(reply, access_token, refresh_token);
      return reply.send({ ok: true });
    },
  );

  // ── Google OAuth — server-initiated PKCE ────────────────────────────────────
  app.get(
    '/google',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const verifier = generateVerifier();
      const challenge = generateChallenge(verifier);
      const callbackUrl = `${env.APP_URL ?? `${req.protocol}://${req.hostname}`}/api/auth/callback`;
      const oauthUrl = buildOAuthUrl(env.SUPABASE_URL, 'google', callbackUrl, challenge);

      reply.setCookie('pkce_verifier', verifier, {
        httpOnly: true,
        secure: SECURE_COOKIE,
        sameSite: 'lax',
        path: '/api/auth/callback',
        maxAge: 60 * 10, // 10 minutes
      });

      return reply.redirect(oauthUrl);
    },
  );

  // ── Google OAuth callback ───────────────────────────────────────────────────
  app.get(
    '/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { code } = req.query as { code?: string };
      const verifier = req.cookies?.pkce_verifier;

      if (!code || !verifier) {
        return reply.redirect(`${env.APP_URL ?? '/'}/login?error=oauth_failed`);
      }

      let tokens;
      try {
        tokens = await supabaseExchangePKCE(
          env.SUPABASE_URL,
          env.SUPABASE_ANON_KEY,
          code,
          verifier,
        );
      } catch {
        return reply.redirect(`${env.APP_URL ?? '/'}/login?error=oauth_failed`);
      }

      setAuthCookies(reply, tokens.access_token, tokens.refresh_token);
      reply.clearCookie('pkce_verifier', { path: '/api/auth/callback' });

      return reply.redirect(env.APP_URL ?? '/');
    },
  );

  // ── Password reset request ──────────────────────────────────────────────────
  app.post(
    '/forgot-password',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { email } = z.object({ email: z.string().email() }).parse(req.body);
      const redirectTo = `${env.APP_URL ?? ''}/reset-password`;
      // Fire-and-forget: don't reveal whether the email exists.
      await supabaseResetPassword(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, email, redirectTo).catch(
        () => void 0,
      );
      return reply.send({ ok: true });
    },
  );

  // ── Session tokens for WebAuthn ────────────────────────────────────────────
  // WebAuthn operations (passkey registration) must run in the browser and require
  // a live Supabase JS session. We expose the tokens from HttpOnly cookies here so
  // the client can temporarily hydrate supabase-js, do the WebAuthn interaction,
  // then immediately clear the session from memory — tokens are never persisted.
  app.get(
    '/session-tokens',
    { preHandler: [requireAuth], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const access_token = req.cookies?.sb_access;
      const refresh_token = req.cookies?.sb_refresh;
      if (!access_token || !refresh_token) throw new HttpError(401, 'Keine aktive Session');
      return reply.send({ access_token, refresh_token });
    },
  );

  // ── Profile update ──────────────────────────────────────────────────────────
  app.patch(
    '/me',
    { preHandler: [requireAuth], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({
          name: z.string().min(1).max(100).optional(),
          lang: z.enum(['de', 'en']).optional(),
          preferredCurrency: z.string().length(3).optional(),
          defaultMarkupRate: z.number().min(0).max(100).optional(),
        })
        .refine(
          (b) =>
            b.name !== undefined ||
            b.lang !== undefined ||
            b.preferredCurrency !== undefined ||
            b.defaultMarkupRate !== undefined,
          'name, lang, preferredCurrency, or defaultMarkupRate required',
        )
        .parse(req.body);

      let updated = null;
      const userUpdate: Record<string, string | number> = {};
      if (body.name) userUpdate.name = body.name.trim();
      if (body.preferredCurrency)
        userUpdate.preferredCurrency = body.preferredCurrency.toUpperCase();
      if (body.defaultMarkupRate !== undefined)
        userUpdate.defaultMarkupRate = body.defaultMarkupRate;
      if (Object.keys(userUpdate).length > 0) {
        updated = await prisma.user.update({
          where: { id: req.user!.id },
          data: userUpdate,
          select: { id: true, email: true, name: true, defaultMarkupRate: true },
        });
      }

      // Sync name/lang to Supabase user_metadata so email templates can use them.
      // Best-effort — a failure here doesn't affect the app.
      const meta: Record<string, string> = {};
      if (body.name) meta.name = body.name.trim();
      if (body.lang) meta.lang = body.lang;
      if (Object.keys(meta).length > 0) {
        const accessToken = req.cookies?.sb_access;
        if (accessToken) {
          await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ data: meta }),
          }).catch(() => {});
        }
      }

      if (updated) return { user: updated };
      return reply.status(204).send();
    },
  );

  // ── Password change ─────────────────────────────────────────────────────────
  // Uses the user's own access token (from cookie) to call Supabase REST — no
  // service role key needed.
  app.post(
    '/change-password',
    { preHandler: [requireAuth], config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { password } = z.object({ password: z.string().min(6) }).parse(req.body);
      const accessToken = req.cookies?.sb_access;
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body: { message?: string } = await res.json().catch(() => ({}));
        throw new HttpError(400, body.message ?? 'Passwort konnte nicht geändert werden');
      }
      return reply.status(204).send();
    },
  );

  // ── Account deletion ────────────────────────────────────────────────────────
  app.delete(
    '/me',
    { preHandler: [requireAuth], config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      try {
        await prisma.user.delete({ where: { id: req.user!.id } });
      } catch (e: unknown) {
        const isFkError =
          typeof e === 'object' &&
          e !== null &&
          'code' in e &&
          (e as { code: string }).code === 'P2003';
        if (isFkError) {
          throw new HttpError(
            409,
            'Konto kann nicht gelöscht werden, da noch Ausgaben oder Abrechnungen vorhanden sind.',
          );
        }
        throw e;
      }
      clearAuthCookies(reply);
      return reply.status(204).send();
    },
  );
}

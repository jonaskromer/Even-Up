import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../services/authService.js';
import { supabaseRefresh } from '../lib/supabaseAuth.js';
import { setAuthCookies } from '../lib/cookies.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/HttpError.js';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string; name: string; defaultMarkupRate: number };
  }
}

const nameSchema = z.string().trim().min(1).max(100);

function extractToken(req: FastifyRequest): string | null {
  // Cookie is the primary path (BFF); Authorization header kept for backward compat and tests.
  const cookie = req.cookies?.sb_access;
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  let token = extractToken(req);
  if (!token) throw new HttpError(401, 'Token fehlt');

  let verified: { sub: string; email: string; name?: string };
  try {
    verified = await verifyToken(token);
  } catch (err) {
    const isExpired =
      typeof err === 'object' && err !== null && 'code' in err && err.code === 'ERR_JWT_EXPIRED';

    if (isExpired) {
      const refreshToken = req.cookies?.sb_refresh;
      if (!refreshToken) throw new HttpError(401, 'Session abgelaufen');
      try {
        const refreshed = await supabaseRefresh(
          env.SUPABASE_URL,
          env.SUPABASE_ANON_KEY,
          refreshToken,
        );
        setAuthCookies(reply, refreshed.access_token, refreshed.refresh_token);
        token = refreshed.access_token;
        verified = await verifyToken(token);
      } catch {
        throw new HttpError(401, 'Session abgelaufen');
      }
    } else {
      throw new HttpError(401, 'Ungültiger Token');
    }
  }

  // user_metadata.name is client-supplied at signup; a valid signature only proves the
  // issuer is genuine, not that the claim content is well-formed, so it's validated
  // (and falls back to the email's local part) before ever being written to the DB.
  const nameResult = nameSchema.safeParse(verified.name);
  const name = nameResult.success ? nameResult.data : verified.email.split('@')[0];

  let user;
  try {
    user = await prisma.user.upsert({
      where: { id: verified.sub },
      create: { id: verified.sub, email: verified.email, name },
      update: { email: verified.email, name },
      select: { id: true, email: true, name: true, defaultMarkupRate: true },
    });
  } catch (e: unknown) {
    // P2002 = unique constraint on email: a row with this email already exists under a
    // different Supabase UUID (e.g. the user previously signed up via email/password and
    // is now logging in via Google OAuth). Fall back to the existing row so they can
    // still access their data.
    const isEmailConflict =
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code: string }).code === 'P2002';
    if (!isEmailConflict) throw e;
    const existing = await prisma.user.findUnique({
      where: { email: verified.email },
      select: { id: true, email: true, name: true, defaultMarkupRate: true },
    });
    if (!existing) throw new HttpError(409, 'E-Mail bereits vergeben');
    user = existing;
  }

  req.user = user;
}

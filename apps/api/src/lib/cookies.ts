import type { FastifyReply } from 'fastify';
import { env } from '../env.js';

const SECURE = !!env.CORS_ORIGIN;

export function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
  reply
    .setCookie('sb_access', accessToken, {
      httpOnly: true,
      secure: SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    })
    .setCookie('sb_refresh', refreshToken, {
      httpOnly: true,
      secure: SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie('sb_access', { path: '/' }).clearCookie('sb_refresh', { path: '/' });
}

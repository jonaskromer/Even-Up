import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../env.js';

export interface VerifiedUser {
  sub: string;
  email: string;
  name?: string;
}

const jwks = env.SUPABASE_JWT_SECRET
  ? null
  : createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
const hmacSecret = env.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
  : null;

export async function verifyToken(token: string): Promise<VerifiedUser> {
  const { payload } = hmacSecret
    ? await jwtVerify(token, hmacSecret)
    : await jwtVerify(token, jwks!);

  const userMetadata = payload.user_metadata as { name?: string; email?: string } | undefined;

  // `email` is a top-level claim for email/password users; for some OAuth providers
  // it may only appear inside user_metadata.
  const email = (payload.email as string | undefined) ?? userMetadata?.email ?? '';

  if (!email) throw new Error('No email claim in JWT');

  return {
    sub: payload.sub as string,
    email,
    name: userMetadata?.name,
  };
}

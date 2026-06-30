import { randomBytes, createHash } from 'node:crypto';

export function generateVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function generateChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildOAuthUrl(
  supabaseUrl: string,
  provider: string,
  redirectTo: string,
  challenge: string,
): string {
  const url = new URL(`${supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set('provider', provider);
  url.searchParams.set('redirect_to', redirectTo);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('flow_type', 'pkce');
  return url.toString();
}

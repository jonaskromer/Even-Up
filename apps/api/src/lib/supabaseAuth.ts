export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface SupabaseErrorBody {
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
}

function headers(anonKey: string) {
  return { 'Content-Type': 'application/json', apikey: anonKey };
}

async function parseError(res: Response): Promise<string> {
  const body: SupabaseErrorBody = await res.json().catch(() => ({}));
  return body.error_description ?? body.msg ?? body.message ?? body.error ?? `HTTP ${res.status}`;
}

export async function supabaseSignIn(
  url: string,
  key: string,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<AuthTokens>;
}

export async function supabaseSignUp(
  url: string,
  key: string,
  email: string,
  password: string,
  name: string,
  lang?: string,
): Promise<{ session: AuthTokens | null }> {
  const data: Record<string, string> = { name };
  if (lang) data.lang = lang;
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ email, password, data }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  // Supabase returns tokens flat ({ access_token, refresh_token, ... }) when email
  // auto-confirm is disabled — not nested under a "session" key. Normalise to { session }.
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (body.access_token && body.refresh_token) {
    return {
      session: {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_in: body.expires_in ?? 3600,
      },
    };
  }
  return { session: null };
}

export async function supabaseRefresh(
  url: string,
  key: string,
  refreshToken: string,
): Promise<AuthTokens> {
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error('Refresh fehlgeschlagen');
  return res.json() as Promise<AuthTokens>;
}

export async function supabaseExchangePKCE(
  url: string,
  key: string,
  code: string,
  verifier: string,
): Promise<AuthTokens> {
  const res = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<AuthTokens>;
}

export async function supabaseResetPassword(
  url: string,
  key: string,
  email: string,
  redirectTo: string,
): Promise<void> {
  // Always returns 200 regardless of whether the email exists — Supabase security feature.
  await fetch(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ email }),
  });
}

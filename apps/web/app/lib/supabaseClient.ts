import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Constructing the real client validates VITE_SUPABASE_URL and throws if it's empty —
// which it is at build time when no real Supabase project has been wired up yet
// (e.g. `docker compose build` with no build args). React Router v7's SPA-mode build
// still pre-renders a static index.html, evaluating this module's imports, so eager
// construction here crashes the build itself. Defer construction until something
// actually calls a method on the client (always at runtime, in the browser).
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      {
        auth: {
          persistSession: false, // session lives in memory only — BFF owns the cookie
          autoRefreshToken: false,
          detectSessionInUrl: false,
          experimental: { passkey: true },
        },
      },
    );
  }
  return client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

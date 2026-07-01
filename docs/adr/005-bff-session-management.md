# ADR 005: BFF-Pattern for Session Management (HttpOnly Cookies)

## Status

Accepted

## Context

After the migration to Supabase Auth (ADR 004), the frontend used `@supabase/supabase-js`
directly. The SDK stores the session (access token + refresh token) in `localStorage` by
default — this is the standard browser storage adapter for SPAs.

This creates a well-known XSS vulnerability: any injected script can read `localStorage`,
extract the session, and make fully-authenticated API requests from anywhere, persisting
across page reloads. The risk is not theoretical — it is the standard attack vector for
token theft in SPAs.

Two alternatives were considered:

1. **`@supabase/ssr`** — Supabase's official cookie-based session package. Rejected: it
   requires server-side rendering to set cookies on the initial HTML response. Even-Up uses
   `ssr: false` (ADR 001) for good reasons, and this can't be changed without fundamental
   re-architecture.

2. **`persistSession: false` + manual token threading** — The supabase-js client can be
   configured to not persist the session; the app would then need to call `setSession()`
   on every page load using tokens stored elsewhere. This solves nothing — tokens still
   need to be stored somewhere on the client, and any client-accessible storage (including
   sessionStorage and in-memory state that re-initializes from somewhere on reload) has the
   same fundamental problem.

Neither alternative preserves SPA mode AND achieves true token isolation from JavaScript.

## Decision

Implement the **Backend-for-Frontend (BFF) pattern**: the Fastify API owns the session
entirely, in **HttpOnly cookies**. The frontend never receives, stores, or handles tokens.

Concretely:

- **Two cookies**: `sb_access` (1h) and `sb_refresh` (30d), set as
  `HttpOnly; Secure; SameSite=Lax; Path=/` via `@fastify/cookie`. The `Secure` flag is
  controlled by `!!CORS_ORIGIN` (off in local dev without a real origin, on in production).
- **All auth logic is server-side.** Login, register, logout, Google OAuth, and token
  refresh are handled by Fastify endpoints calling the Supabase Auth REST API directly
  (no SDK on the server — pure `fetch()` to `/auth/v1/*`).
- **`requireAuth` middleware** reads `req.cookies.sb_access` first, falls back to
  `Authorization: Bearer` for backward compatibility with tests. On `ERR_JWT_EXPIRED`
  with a refresh cookie present: calls `supabaseRefresh`, sets new cookies, re-verifies.
  The client never sees a 401 due to token expiry.
- **Server-side PKCE for Google OAuth.** `GET /api/auth/google` generates a PKCE verifier
  using `node:crypto` (`randomBytes(32).toString('base64url')`), hashes it
  (SHA-256/base64url), stores the verifier in a `pkce_verifier` HttpOnly cookie (10min),
  and redirects the browser to the Supabase OAuth URL. `GET /api/auth/callback` reads the
  verifier cookie, exchanges the code via Supabase REST, and sets auth cookies. The browser
  followed redirects but never held a token.
- **Frontend**: `credentials: 'include'` on all `fetch()` calls (the only change needed
  in `apiClient.ts`). The `supabase-js` client is kept for WebAuthn only, with
  `persistSession: false, autoRefreshToken: false, detectSessionInUrl: false` — it writes
  nothing to localStorage ever.
- **`GET /api/auth/session-tokens`** — a controlled token-exposure endpoint: returns the
  current cookie tokens in the response body, so `supabase.auth.setSession()` can load
  them into memory for a WebAuthn registration ceremony. After `registerPasskey()` the
  in-memory session is cleared with `signOut({ scope: 'local' })`. This is the only
  pathway where a token appears in JavaScript, and it is ephemeral (in-memory, not
  persisted, immediately cleared after use).

## Rationale

- **HttpOnly cookies cannot be read by JavaScript.** A successful XSS attack can run
  arbitrary scripts, but cannot read an HttpOnly cookie — the browser never exposes it to
  the JavaScript context. This is the correct defense for persistent session credentials.
- **SPA mode preserved.** No SSR is needed. The Vite/React Router SPA architecture is
  unchanged. All auth flows are full-page redirects or fetch calls — both work with cookies.
- **Auto-refresh is transparent.** The `requireAuth` middleware handles refresh silently;
  no client-side token management, no 401 handling in the frontend, no race conditions on
  token expiry.
- **Server-side PKCE is the correct OAuth flow for server-controlled auth.** When a server
  manages the session, the server should control the PKCE exchange — not a client-side SDK
  that would need to store the verifier in some client-accessible location.
- **`persistSession: false` makes the supabase-js client safe for WebAuthn.** The SDK is
  needed only for `signInWithPasskey()` and `registerPasskey()`, which cannot be replicated
  in pure REST. With `persistSession: false`, the client is stateless between sessions and
  never touches localStorage.

## Password Reset Exception

`apps/web/app/routes/reset-password.tsx` still uses the client-side Supabase SDK
(`exchangeCodeForSession`, `updateUser`, `signOut`). The PKCE verifier for the reset flow
was generated by Supabase when sending the email link; the same browser session must
complete the exchange (the verifier is bound to the browser via cookie). This flow cannot
be server-proxied without re-architecting the email link itself. The reset token is
single-use and short-lived (ephemeral recovery session), so the risk exposure is
explicitly accepted as low.

## TypeScript Integration

`@fastify/cookie` v11 lacks an `exports` field, so NodeNext module resolution does not
automatically apply the package's module augmentations for `FastifyRequest.cookies` and
`FastifyReply.setCookie`. The same pattern as `@fastify/rate-limit`: a local
re-declaration in `apps/api/src/types/cookie.d.ts` restores correct types without
forking the package or downgrading resolution mode.

## Consequences

- **All auth routes are new.** The auth route module is completely new (login, register,
  logout, refresh, exchange, google, callback, forgot-password, session-tokens, me, PATCH
  me, change-password, DELETE me) — the surface area of the BFF is larger than a simple
  "add cookie" change.
- **E2E tests can no longer inject tokens.** There is no localStorage to patch. Playwright
  tests mock `GET /api/auth/me` at the network level instead — cleaner, but different
  strategy from what supabase-js localStorage interception would have allowed.
- **Passkey login requires `refreshUser()`.** After a passkey login, the SPA navigates
  via React Router (no full-page reload). `AuthContext` is not re-mounted, so its
  `useEffect([])` does not re-run. `refreshUser()` must be called explicitly after the
  passkey exchange to populate `user`. Google OAuth does not have this issue — the server
  redirect at the end of the callback is a full-page load.
- **Local dev requires no `CORS_ORIGIN`.** Cookies work on `localhost` without HTTPS; the
  `Secure` flag is skipped when `CORS_ORIGIN` is unset.

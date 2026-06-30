# ADR 004: Supabase Auth (Cloud) Replaces Custom JWT Auth

## Status

Accepted

## Context

The app previously rolled its own authentication: bcrypt-hashed passwords stored on
`User.passwordHash`, self-issued JWTs (`jsonwebtoken`) signed with a shared `JWT_SECRET`,
verified per-request in `requireAuth`, plus a hand-rolled password-reset flow backed by
the `PasswordResetToken` table and a custom email send. This is the approach
`README.md` and `docs/architecture.md` previously documented as "Custom JWT (bcrypt +
jsonwebtoken)".

Maintaining this in-house meant owning password hashing, token issuance/rotation,
session/refresh handling, and the reset-token lifecycle — all security-sensitive code
with no external review, on top of an already-working, tested app.

## Decision

Replace the custom auth system with **Supabase Auth**, using **Supabase Cloud**
(hosted) rather than self-hosting the full Supabase stack. The existing self-hosted
Postgres + Prisma database is **kept** for all application data — only
identity/credentials move to Supabase.

The frontend (`apps/web`) talks to Supabase directly via `@supabase/supabase-js` for
sign-up, login, logout, and password reset. The backend (`apps/api`) verifies the
Supabase-issued JWT on each request (via `jose`, against Supabase's JWKS endpoint or a
shared HS256 secret) and lazily provisions a local `User` row — keyed on the Supabase
`sub` (user id) — on the first authenticated request seen for that user, via
`prisma.user.upsert()`. No signup webhook from Supabase back to the API is needed.

Supabase's own confirmation/reset emails are routed through the same Resend account
already used by `emailService.ts` (custom SMTP, configured in the Supabase dashboard)
and the email templates are customized to match the app's branding, so there is exactly
one signup email — the app's own `sendWelcomeEmail` is removed rather than running
alongside Supabase's.

## Rationale

- **Less security-sensitive code to own.** Password hashing, token signing, and
  reset-token issuance/expiry are now Supabase's responsibility, not this app's.
- **Cloud over self-hosted Supabase.** Self-hosting the full Supabase stack (Auth +
  Postgres + Studio + Realtime, etc.) for auth alone would mean operating another
  Postgres cluster purely for `auth.users`, with no benefit here since the existing
  application database is kept as-is.
- **Lazy provisioning over a webhook.** A Supabase→backend signup webhook can't reach a
  local dev backend, and isn't needed: the first authenticated request from a new user
  is a fine trigger point, and `upsert()` keyed on `id` makes concurrent first-requests
  from a brand-new user safe.
- **JWKS verification over `supabase-js` server-side.** `auth.getUser(token)` would mean
  a network round-trip to Supabase per request inside `requireAuth`. Verifying the JWT
  locally via `jose`'s `createRemoteJWKSet` (cached, only re-fetches on key rotation) is
  far cheaper.

## Data Model

`User.id` is no longer an auto-generated `cuid()` — it's now explicitly set by the API
to the Supabase Auth user id (UUID) the first time a verified token for that user is
seen. `User.passwordHash` and the `PasswordResetToken` table are dropped; Supabase owns
both the password and the reset-token lifecycle.

## Consequences

- **One-way migration.** Existing `User` rows created under the old scheme have no
  corresponding Supabase Auth user, and their `id` was a `cuid()`, not a Supabase UUID.
  This repo had no real production users at the time of migration (only demo/seed/test
  data), so no data-migration step was built. Migrating a deployment with real users
  would require first creating matching Supabase Auth users (e.g. via the Admin API)
  with the same `id` as each existing `User` row, or accepting new accounts.
- **No cascade on Supabase-side user deletion.** Deleting a user in Supabase Auth does
  not delete the corresponding local `User` row or its relations — Supabase has no
  knowledge of this schema. This is an accepted gap, not handled via a Database Webhook.
- **`requireAuth`-validates `user_metadata.name`.** A valid JWT signature only proves
  the issuer is genuine, not that client-supplied claims (like the name set at signup)
  are well-formed, so it's validated (and falls back to the email's local part) before
  ever being written to the DB.
- **Local dev needs a real or emulated Supabase project.** `SUPABASE_URL` must point at
  either a real Supabase Cloud project or a local `supabase start` instance for sign-up
  and login to work; demo/seed users created directly in the database (see
  `prisma/seed.ts`) aren't loggable until a matching Supabase Auth user with the same
  UUID is created manually.
- **Vite build-time env vars.** `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are
  inlined at build time, so production Docker builds need them as build `ARG`s
  (`apps/web/Dockerfile`, `docker-compose.prod.yml`), not just runtime env vars.

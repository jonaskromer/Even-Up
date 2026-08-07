# Even-Up

A web application for splitting expenses fairly among groups. Create groups for your flatshare, trips, or events, log shared expenses, and let Even-Up calculate who owes whom — with optional debt simplification to minimize the number of transfers.

**Live app:** [even-up.dev](https://even-up.dev) — sign in with the demo account below, or register your own.

| Email               | Password | Group                          |
| ------------------- | -------- | ------------------------------- |
| `demo@even-up.local` | `demo`   | Ski Trip 2026 (with anna, ben)  |

---

## Core Features

### Groups & Members

- Create and manage groups (e.g. "Ski Trip 2026", "Flat Sonnenstraße")
- Invite members by email — they must accept the request before becoming a member (or
  join instantly via a shareable invite link, 7-day expiry)
- Header notification bell shows pending incoming invitations across all pages, with
  accept/decline actions
- Per-group member list with roles (owner / member), plus a view of outstanding
  outgoing invitations
- Email notifications for join requests (invite sent, invite accepted) via Resend when configured

### Expense Tracking

- Log expenses with title, amount, date, and payer
- **Multi-currency** — choose any of 31 currencies (ECB/Frankfurter API) per expense; the API converts to the group's base currency using the historical exchange rate for the expense date (automatic v1 fallback when v2 cannot serve today's rate); rates are cached permanently in the DB; original amount and currency are always stored for display
- **Credit card FX markup** — optional percentage markup applied on top of the exchange rate conversion, reflecting real-world credit card foreign-transaction fees; configurable per user in Settings and pre-filled when creating or editing an expense
- Group currency toggle: view balances either converted to the group's base currency or broken down per original currency
- Preferred currency is saved per user account and used when creating a new group
- Select how the cost is split:
  - **Equal** — evenly among all members
  - **Exact** — specific amounts per person
  - **Percentage** — percentage-based split
  - **Shares** — weighted shares (e.g. 2:1:1)
- **Receipt scanning (AI-assisted)** — photograph or upload a receipt; Google Gemini
  extracts the store name, date, and every line item (with net/gross tax and per-item
  discount reconciliation) as structured data; a review screen lets you assign each
  item to group members with its own split mode (equal/exact/percent/shares), exclude
  irrelevant lines (e.g. a deposit refund) without losing them, and see a live
  per-member running total before saving one expense with the resulting splits. The
  line items remain stored and re-editable later via "Edit line items" on the expense.
  Optional — hidden entirely if `GEMINI_API_KEY` isn't configured. See
  [ADR 012](docs/adr/012-receipt-ai-parsing.md)

### Balances & Settlements

- Real-time net balance per person within each group
- "Settle up" flow to record payments, with edit and delete for previously recorded settlements
- **Debt simplification** — reduces the number of required transfers without changing anyone's net balance (min-cash-flow algorithm)

### Authentication & Account

- Email/password registration and login handled entirely by the Fastify **BFF**
  (Backend-for-Frontend) — the browser only ever holds `HttpOnly` session cookies
  (`sb_access` 1h, `sb_refresh` 30d), never a token in JavaScript; the BFF talks to
  Supabase Auth's REST API directly and transparently refreshes an expired access
  token using the refresh cookie — see [ADR 005](docs/adr/005-bff-session-management.md)
- **Google sign-in** via server-side PKCE OAuth (`/api/v1/auth/google` → Supabase → Google
  → `/api/v1/auth/callback`) — the browser only follows redirects, never sees a token
- **Passkey (WebAuthn)** sign-in and registration via `supabase-js`, configured with
  `persistSession: false` so it never touches `localStorage`
- Local `User` row is lazily provisioned (`upsert`) on the first authenticated request
  for a given Supabase user — no signup webhook needed
- Protected routes on both client (loader-level redirect) and server (Fastify preHandler)
- Change password and delete account (with a guard against deleting a user who has
  shared financial records other members depend on)
- Password reset and signup-confirmation emails are sent by Supabase itself, routed
  through the app's existing Resend account (custom SMTP) with branded templates — see
  [ADR 004](docs/adr/004-supabase-auth.md)

### UI & Quality of Life

- Dark mode (system preference detected on load, manual toggle persisted to localStorage)
- CSV import for bulk expense entry (column-based, email matching, preview before import)
- Activity log per group with load-more pagination (expenses added/edited/deleted, settlements recorded/edited/deleted, members invited/joined)
- Global activity feed on the dashboard aggregating events across all of the user's groups
- Load-more pagination for expense lists and activity logs — first 20 items shown, more loaded on demand

---

## Tech Stack

| Layer                   | Technology                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **Framework**           | React Router v8 (SPA mode, file-based routing, Loaders)                                       |
| **Styling**             | Tailwind CSS 3 + shadcn/ui (Button, Card, Input, Label, Alert)                                |
| **Language**            | TypeScript (strict mode, end-to-end)                                                          |
| **Build**               | Vite                                                                                          |
| **API**                 | Fastify (REST)                                                                                |
| **Validation**          | Zod (shared schemas between client and server)                                                |
| **Auth**                | Supabase Auth (Cloud) via a Fastify BFF — HttpOnly cookie sessions, JWT verified server-side via `jose`/JWKS, server-side PKCE for Google OAuth |
| **Database**            | PostgreSQL 16 + Prisma 7 ORM (`@prisma/adapter-pg`)                                           |
| **AI**                  | Google Gemini (receipt OCR/line-item extraction — vision input, native JSON structured output, retry + primary/secondary model fallback) |
| **Email**               | Resend (join-request emails; Supabase's auth emails are SMTP-routed through the same account) |
| **Reverse Proxy / TLS** | Caddy (automatic Let's Encrypt HTTPS in production)                                           |
| **Testing**             | Vitest, React Testing Library, Fastify `app.inject()`, Playwright (E2E, mocked auth)           |
| **Tooling**             | npm workspaces, ESLint, Prettier, Husky + lint-staged, GitHub Actions CI, Make                |

---

## Architecture

```
+------------------------------------------+
|              Browser (SPA)               |
|  React Router 8 / clientLoader / Vite    |
|  Tailwind CSS / shadcn/ui / Zod          |
+----------------+-------------------------+
                 |
                 |  HTTP/JSON (HttpOnly cookie session — no
                 |  token ever reaches JavaScript)
                 v
+----------------+-------------------------+
|        Fastify REST API (BFF)            |
|  Owns the session: login/register/logout,|
|   Google OAuth (server-side PKCE), token |
|   refresh all call Supabase Auth's REST  |
|   API directly                           |
|  Zod request validation (shared schemas) |
|  requireAuth: verifies Supabase JWT      |
|   (cookie-first), auto-refreshes,        |
|   lazily upserts local User row          |
|  Route modules: auth, groups, expenses,  |
|   settlements, invites, activities,      |
|   join-requests, receipts (Gemini OCR)   |
+----------------+-------------------------+
                 |              |
                 |  Prisma ORM  |  HTTPS (image + prompt,
                 v              |  discarded after response)
+----------------+-------------------------+   v
|            PostgreSQL 16                 |  Google Gemini API
|  User, Group, GroupMember, Expense       |  (receipt line-item
|  ExpenseSplit, Settlement, GroupInvite   |   extraction)
|  Activity, GroupJoinRequest, ExchangeRate|
|  ReceiptLineItem, ReceiptLineItemAssignment
+------------------------------------------+
  Supabase Cloud: auth.users (credentials,
  sessions) separate from this database
```
---
## Getting Started

### Option A — Reproducibly startable via Docker Compose

Single prerequisite: Docker.

```bash
cp .env.example .env             # set SUPABASE_URL/VITE_SUPABASE_* and POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up --build
```

This builds and starts four containers — PostgreSQL, the Fastify API, an nginx-served
production build of the frontend, and a Caddy reverse proxy — and runs migrations +
demo-data seeding automatically on first start. Open **http://localhost** (Caddy
redirects to HTTPS using a local self-signed cert when no real domain is configured).

- Caddy is the only public entrypoint; nginx (internal) proxies `/api/*` to the API
  container, so there is no CORS configuration and no separate API URL to set.
- With `DOMAIN` left at its default (`localhost`), Caddy serves over HTTPS with a
  locally-trusted cert. Set `DOMAIN=your-domain.com` (pointed at the
  server) to get a real, free Let's Encrypt certificate automatically — no extra config.
- The seed is idempotent — restarting the `api` container will not duplicate demo data.
- Stop with `docker compose -f docker-compose.prod.yml down` (add `-v` to also wipe the database).

### Option B — Local development (hot reload)

**Prerequisites:** Node.js >= 22, Docker (for PostgreSQL only).

**Shortcut:** `npm install`, then `make dev` — starts the database, applies migrations,
seeds demo data, and runs both the API and frontend dev servers in one terminal with
hot reload. `Ctrl+C` stops both. See [Operations → Makefile](#makefile) for details.

Equivalent manual steps, if you'd rather run each piece yourself (e.g. in separate
terminals or your IDE's run configs):

```bash
# 1. Start the database
docker compose up -d

# 2. Install dependencies (also builds packages/shared)
npm install

# 3. Set up the API
cd apps/api
cp ../../.env.example .env      # adjust values as needed
npx prisma generate             # generate the Prisma client
npx prisma migrate dev          # run migrations
npx prisma db seed              # seed demo data
npm run dev                     # API on http://localhost:4000

# 4. Start the frontend (separate terminal)
cd apps/web
npm run dev                     # Vite on http://localhost:5173
```

The seed creates the demo account listed at the top of this README (`demo@even-up.local` / `demo`).

### Running Tests

```bash
# From repo root, per workspace
npm test --workspace=apps/api   # API: auth, expenses (incl. CSV export), balances, settlements, debt simplification, join requests, exchange rates, receipts, Gemini parsing, OpenAPI/versioning (104 tests)
npm test --workspace=apps/web   # Frontend: utils, computeBalances, computePerCurrencyBalances, receiptSplits, ExpenseItem, ExportExpensesButton, AddExpenseForm, LoadingState, ErrorState, receipt route loader (68 tests)
npm run test:e2e                # Playwright E2E (auth, dashboard) — requires `npx playwright install` once
```

---

## Operations

Reference for running and maintaining a live deployment, beyond the first-run steps above.

### Makefile

A `Makefile` at the repo root wraps the common commands for both local development and
a deployed server.

**Local development** (uses `docker-compose.yml`, the Postgres-only dev database):

| Command          | What it does                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make dev`       | Run `dev-setup`, then start the API and frontend dev servers concurrently in one terminal (hot reload). `Ctrl+C` stops both.                                                                                                                    |
| `make dev-setup` | Idempotent setup only: start the dev database (waits for healthy), create `apps/api/.env` if missing, run `prisma generate` + `migrate deploy` + the seed. Useful if you'd rather run the API/frontend dev servers yourself (e.g. in your IDE). |

**Deployed server** (uses `docker-compose.prod.yml`, see [Deploying to a remote server](#deploying-to-a-remote-server)):

| Command            | What it does                                                          |
| ------------------ | --------------------------------------------------------------------- |
| `make deploy`      | `git pull` + rebuild images + restart the stack — the standard update |
| `make build`       | Rebuild the Docker images only                                        |
| `make up` / `down` | Start / stop the stack (`down` keeps the database volume)             |
| `make restart`     | `down` + `up` without rebuilding                                      |
| `make logs`        | Tail logs for all services (`SERVICE=api make logs` to filter one)    |
| `make ps`          | Show container status                                                 |
| `make clean`       | Stop the stack and wipe the database volume                           |
| `make help`        | List all targets                                                      |

### Deploying to a remote server

1. SSH into the server and install Docker: `curl -fsSL https://get.docker.com | sh`
2. Clone the repo and `cd` into it.
3. `cp .env.example .env` and set `SUPABASE_URL`/`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` (from your Supabase Cloud project's Settings → API) and a real `POSTGRES_PASSWORD` — never commit this file.
4. Point your domain's DNS A-record at the server's IP, then set `DOMAIN=your-domain.com` in `.env`.
5. Open the firewall for HTTP/HTTPS (`80`, `443`) and SSH (`22`).
6. `make deploy` (equivalent to `docker compose -f docker-compose.prod.yml up --build -d`).

Caddy automatically obtains and renews a Let's Encrypt certificate for `DOMAIN` — no
manual certbot setup. `restart: unless-stopped` in the compose file means the stack
survives a server reboot automatically. To update a running deployment after pushing
new code, just run `make deploy` again — migrations and the demo seed are idempotent.

### Transactional Emails

Two emails are sent via Resend directly by this app, in
`apps/api/src/services/emailService.ts`:

| Email                 | Sent when                            | Behavior without `RESEND_API_KEY`                           |
| --------------------- | ------------------------------------ | ----------------------------------------------------------- |
| Join request invite   | `POST /api/v1/groups/:id/members`       | Not sent — invitee only sees it via the bell                |
| Join request accepted | `POST /api/v1/join-requests/:id/accept` | Not sent — inviter only sees it in the group's activity log |

Both are fire-and-forget — a failed send is logged server-side but never blocks or
fails the underlying request. They share one branded HTML template (table-based
layout, inline styles for email client compatibility) using the same color palette as
the web app's `:root` CSS variables — converted from HSL to hex, since email clients
don't reliably support `hsl()`/CSS variables.

Signup-confirmation and password-reset emails are sent by **Supabase Auth** itself, not
this app — they're configured in the Supabase dashboard (Authentication → Settings →
SMTP Settings) to route through the same Resend account/domain, with branded templates
under Authentication → Email Templates, so there's exactly one signup email rather than
one from Supabase and a separate one from this app. See
[ADR 004](docs/adr/004-supabase-auth.md).

To send the two app-side emails in production:

1. Create a free account at [resend.com](https://resend.com) and add/verify your domain
   there (it gives you DNS records — SPF, DKIM — to add at your registrar).
2. Set in `.env`:
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=Even-Up <noreply@your-domain.com>
   APP_URL=https://your-domain.com
   ```
3. `make deploy`.

### Receipt Scanning (Gemini)

The "Add Receipt" feature is entirely optional — if `GEMINI_API_KEY` is unset, the
button is hidden client-side and the parse endpoint 404s, with no effect on any other
part of the app. To enable it:

1. Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Set in `.env`:
   ```
   GEMINI_API_KEY=AIzaSy...
   GEMINI_MODEL_PRIMARY=gemini-3.5-flash
   GEMINI_MODEL_SECONDARY=gemini-2.5-flash
   ```
3. `make deploy` (or restart your local dev server — env vars aren't hot-reloaded).

The primary model is retried up to 3 times with a random jitter delay before falling
back to the secondary model once; both model names are configurable so either can be
bumped without a code change. See [ADR 012](docs/adr/012-receipt-ai-parsing.md).

### Logs

The API uses Fastify's built-in logger (pino), enabled in development and production but disabled during tests (`NODE_ENV=test`) to keep test output clean. Each request produces two JSON lines — `incoming request` and `request completed` (with status code and response time):

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

### CI Pipeline

Seven jobs run on every push/PR to `main` or `dev` (`.github/workflows/ci.yml`): a
dependency audit (`npm audit --audit-level=high`), lint + format check, typecheck (both
workspaces, with React Router typegen run first), API tests (against a real Postgres
service container), frontend tests, Playwright E2E tests, and a Docker build + smoke
test that builds the production images, brings the full stack up, and verifies the
public entrypoint actually responds. See [docs/architecture.md](docs/architecture.md)
for the full pipeline diagram.

---

## Documentation

| Document                                                                 | Description                                                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                                     | System overview, frontend component hierarchy, auth flow, data flow, security model, testing strategy                                         |
| [API Reference](docs/api-reference.md)                                   | Full REST API documentation with request/response examples for every endpoint                                                                 |
| [ADR 001 — SPA Mode](docs/adr/001-spa-mode.md)                                         | Why SPA over SSR for a fully authenticated app                                                                |
| [ADR 002 — Debt Simplification](docs/adr/002-debt-simplification.md)                   | Greedy min-cash-flow algorithm: rationale, pseudocode, complexity analysis                                    |
| [ADR 003 — Prisma Driver Adapter](docs/adr/003-prisma-driver-adapter.md)               | Prisma 5 → 7 migration: driver adapter, generated client, config changes                                      |
| [ADR 004 — Supabase Auth](docs/adr/004-supabase-auth.md)                               | Custom JWT → Supabase Auth (Cloud) migration: rationale, data model, consequences                             |
| [ADR 005 — BFF Session Management](docs/adr/005-bff-session-management.md)             | HttpOnly cookie session storage via BFF pattern — eliminates localStorage XSS risk                            |
| [ADR 006 — Server-side Split Validation](docs/adr/006-server-side-split-validation.md) | Why split amounts are validated and stored server-side rather than trusted from the client                     |
| [ADR 007 — React Router v8 / Node 22](docs/adr/007-react-router-v8-node22-upgrade.md) | Upgrade rationale, cross-platform lockfile fix, eslint-plugin-react-hooks v7 migration                        |
| [ADR 008 — CSP Build-time Hash Injection](docs/adr/008-csp-build-time-hash-injection.md) | Content Security Policy with inline-script hashes injected at build time via Vite plugin                    |
| [ADR 009 — Load-more Pagination](docs/adr/009-load-more-pagination.md)                 | Offset-based pagination for expenses/activities: `{ items, total }` shape, key-prop reset pattern             |
| [ADR 010 — Multi-currency](docs/adr/010-multi-currency.md)                             | Per-expense currency with historical ECB rates via Frankfurter API; permanent DB cache; dual-amount storage    |
| [ADR 011 — Credit Card FX Markup](docs/adr/011-credit-card-fx-markup.md)               | Per-user default + per-expense override markup percentage applied post-conversion                             |
| [ADR 012 — Receipt AI Parsing](docs/adr/012-receipt-ai-parsing.md)                     | Gemini OCR with retry/fallback models, streamed progress, normalized line-item schema, per-item split modes    |
| [ADR 013 — CSV Export Format](docs/adr/013-csv-export-format.md)                       | Export matches import's wide, Splitwise-style format; members keyed by email, not id/name; rounding-drift tolerance |
| [ADR 014 — API Versioning & OpenAPI](docs/adr/014-api-versioning-and-openapi.md)        | `/api/v1` URL-path versioning centralized in one frontend helper; static OpenAPI spec reusing real Zod schemas via `z.toJSONSchema()` |

---

## Known Limitations

- No real-time sync — uses `useRevalidator` for manual refresh after mutations
- Split modes beyond "equal" (percentage, shares) are selectable in the UI but not fully wired end-to-end — the API always stores the exact cent amounts calculated at submission
- Deleting a user in Supabase Auth does not cascade to the local `User` row or its relations — an accepted gap, not handled via a Database Webhook (see [ADR 004](docs/adr/004-supabase-auth.md))
- No mobile app — responsive web only
- Duplicate-join-request prevention is enforced at the application level (a check-then-create), not via a database constraint — a small race window exists where two concurrent invites to the same person could both succeed
- CORS is restricted to `CORS_ORIGIN` env var (defaults to `localhost:5173/4173/5174/4174` for local dev); allowed methods include `PATCH` explicitly
- `equal`-mode splits don't remainder-correct: `computeAndValidateSplits()` gives every member `Math.round(amountCents / memberCount)`, so on an amount not evenly divisible by the member count, the stored splits can sum to up to `memberCount − 1` cents more or less than the expense total. This is accepted/unvalidated at creation time; CSV export's schema tolerates the same drift rather than rejecting otherwise-valid data (learned the hard way — see `apps/api/src/tests/expenses.test.ts`'s rounding-drift regression test)

---

## License

University semester project — not licensed for distribution.

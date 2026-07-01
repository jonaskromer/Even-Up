# Even-Up

A web application for splitting expenses fairly among groups. Create groups for your flatshare, trips, or events, log shared expenses, and let Even-Up calculate who owes whom — with optional debt simplification to minimize the number of transfers.

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
- **Google sign-in** via server-side PKCE OAuth (`/api/auth/google` → Supabase → Google
  → `/api/auth/callback`) — the browser only follows redirects, never sees a token
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
- CSV import for bulk expense entry (column-based, name matching, preview before import)
- Activity log per group with load-more pagination (expenses added/edited/deleted, settlements recorded/edited/deleted, members invited/joined)
- Global activity feed on the dashboard aggregating events across all of the user's groups
- Load-more pagination for expense lists and activity logs — first 20 items shown, more loaded on demand
- Member email shown alongside name in balances and member panels to disambiguate same-name users

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

### Why SPA over SSR?

Even-Up is a fully authenticated, interactive application. Every view depends on the logged-in user's data. Server-side rendering adds complexity without SEO benefit here. A client-side SPA with Supabase Auth and Fastify as a dedicated API layer is the simplest architecture that fits the problem. See [ADR 001](docs/adr/001-spa-mode.md) for full rationale.

### Shared Validation

Zod schemas live in a shared `packages/shared` workspace. Both the React Router loaders (client-side) and Fastify route handlers (server-side) import the same schemas — a single source of truth for what constitutes a valid expense, group, or settlement.

---

## Data Model

All monetary values are stored as **integer cents** to avoid floating-point rounding errors.

| Entity               | Key Fields                                                                   |
| -------------------- | ---------------------------------------------------------------------------- |
| **User**             | id (Supabase Auth user id), name, email, preferredCurrency, defaultMarkupRate, createdAt |
| **Group**            | id, name, currency (base currency), createdAt, updatedAt                     |
| **GroupMember**      | groupId, userId, role                                                        |
| **Expense**          | id, groupId, paidByUserId, description, amountCents (converted to group currency), originalAmountCents, originalCurrency, appliedMarkupRate, splitMode, date, receiptStoreName? |
| **ExpenseSplit**     | expenseId, userId, owedCents                                                 |
| **Settlement**       | id, groupId, fromUserId, toUserId, amountCents, date, note?                  |
| **GroupInvite**      | id, token (unique), groupId, createdBy, expiresAt                            |
| **Activity**         | id, groupId, userId, type, data (JSON), createdAt                            |
| **GroupJoinRequest** | id, groupId, invitedUserId, invitedByUserId, status, createdAt, respondedAt? |
| **ExchangeRate**     | id, date, fromCurrency, toCurrency, rate (unique on date+from+to — permanent cache) |
| **ReceiptLineItem**  | id, expenseId, name, quantity, priceCents, sortOrder, excluded, splitMode (equal/exact/percent/shares) |
| **ReceiptLineItemAssignment** | lineItemId, userId, shareWeight, exactCents?, percent? (only the field matching the item's splitMode is used) |

Credentials and password-reset tokens live entirely in Supabase Auth's own `auth.users`
table (managed by Supabase, separate from this database) — there is no `passwordHash`
or password-reset-token table in this app's schema.

---

## API Endpoints

### Auth

All auth is handled by the Fastify BFF — the browser only ever holds `HttpOnly`
session cookies, never a token in JavaScript. See [ADR 005](docs/adr/005-bff-session-management.md)
and [docs/api-reference.md](docs/api-reference.md#authentication) for full request/response
details of every endpoint below.

| Method | Path                          | Description                                       |
| ------ | ----------------------------- | -------------------------------------------------- |
| POST   | `/api/auth/register`          | Create account, sets session cookies                |
| POST   | `/api/auth/login`              | Email/password login                                |
| POST   | `/api/auth/logout`             | Clear session cookies                               |
| POST   | `/api/auth/refresh`            | Refresh the access token using the refresh cookie   |
| GET    | `/api/auth/google`             | Start server-side PKCE Google OAuth flow            |
| GET    | `/api/auth/callback`           | Google OAuth callback, sets session cookies         |
| POST   | `/api/auth/exchange`           | Exchange a client-side token pair (passkeys) for cookies |
| POST   | `/api/auth/forgot-password`    | Send a Supabase password-reset email                |
| GET    | `/api/auth/session-tokens`     | Expose current cookie tokens (WebAuthn enrollment only) |
| GET    | `/api/auth/me`                 | Current user profile (includes `defaultMarkupRate`) |
| PATCH  | `/api/auth/me`                 | Update name, language, preferred currency, or `defaultMarkupRate` |
| POST   | `/api/auth/change-password`    | Change password via the current session             |
| DELETE | `/api/auth/me`                 | Delete account (`409` if shared financial records exist) |

### Groups

| Method | Path                       | Description                                             |
| ------ | -------------------------- | ------------------------------------------------------- |
| GET    | `/api/groups`              | List user's groups                                      |
| POST   | `/api/groups`              | Create group                                            |
| GET    | `/api/groups/:id`          | Group detail                                            |
| POST   | `/api/groups/:id/members`  | Invite member by email (creates a pending join request) |
| GET    | `/api/groups/:id/balances` | Net balances per member                                 |

### Expenses

| Method | Path                            | Description                |
| ------ | ------------------------------- | -------------------------- |
| GET    | `/api/groups/:id/expenses`      | List expenses (paginated, `?limit=20&offset=0`) |
| POST   | `/api/groups/:id/expenses`      | Create expense with splits (optional `currency` + `markupRate` fields trigger FX conversion with markup) |
| GET    | `/api/groups/:id/expenses/:eid` | Single expense (used by edit route) — includes `lineItems`/`receiptStoreName` for receipt-created expenses |
| PUT    | `/api/groups/:id/expenses/:eid` | Update expense (optional `currency` + `markupRate` fields trigger FX conversion with markup) |
| DELETE | `/api/groups/:id/expenses/:eid` | Delete expense             |

### Settlements

| Method | Path                                         | Description              |
| ------ | --------------------------------------------- | ------------------------- |
| GET    | `/api/groups/:id/settlements`                | List recorded settlements |
| POST   | `/api/groups/:id/settlements`                | Record a settlement       |
| PUT    | `/api/groups/:id/settlements/:settlementId`  | Update a settlement       |
| DELETE | `/api/groups/:id/settlements/:settlementId`  | Delete a settlement       |
| GET    | `/api/groups/:id/settle-up?simplify=true`    | Suggested transfers       |

### Receipts (AI-assisted expense creation)

| Method | Path                                    | Description                                                                                             |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| POST   | `/api/groups/:id/receipts/parse`        | Upload a receipt image; streams retry/fallback progress, then the extracted store/line items (NDJSON)    |
| POST   | `/api/groups/:id/receipts`              | Create one expense from reviewed line items + per-item splits                                             |
| PUT    | `/api/groups/:id/receipts/:expenseId`   | Replace an expense's line items + splits                                                                  |

### Invites

| Method | Path                         | Description                         |
| ------ | ---------------------------- | ----------------------------------- |
| POST   | `/api/groups/:id/invites`    | Generate invite link (7-day expiry) |
| POST   | `/api/invites/:token/accept` | Accept invite and join group        |

### Activities

| Method | Path                         | Description                         |
| ------ | ---------------------------- | ----------------------------------- |
| GET    | `/api/activities`            | Activity events across all of the user's groups (paginated, powers the dashboard's global feed) |
| GET    | `/api/groups/:id/activities` | Activity events for a group (paginated, `?limit=20&offset=0`) |

### Join Requests

| Method | Path                             | Description                              |
| ------ | -------------------------------- | ---------------------------------------- |
| GET    | `/api/groups/:id/join-requests`  | Pending outgoing invites for a group     |
| GET    | `/api/join-requests`             | Current user's pending incoming requests |
| POST   | `/api/join-requests/:id/accept`  | Accept a request and join the group      |
| POST   | `/api/join-requests/:id/decline` | Decline a request                        |

---

## Project Structure

```
/
├── apps/
│   ├── web/                    # React Router v8 SPA
│   │   ├── app/
│   │   │   ├── routes/         # File-based routes with clientLoaders
│   │   │   │   ├── _index.tsx           # / (dashboard)
│   │   │   │   ├── login.tsx            # /login
│   │   │   │   ├── register.tsx         # /register
│   │   │   │   ├── forgot-password.tsx  # /forgot-password
│   │   │   │   ├── reset-password.tsx   # /reset-password?token=…
│   │   │   │   ├── auth.callback.tsx    # /auth/callback (Google OAuth landing)
│   │   │   │   ├── settings.tsx         # /settings (profile, currency, markup, password, account deletion)
│   │   │   │   ├── groups.new.tsx       # /groups/new
│   │   │   │   ├── groups.$groupId.tsx  # /groups/:id
│   │   │   │   ├── groups.$groupId_.new-expense.tsx
│   │   │   │   ├── groups.$groupId_.expenses.$expenseId.edit.tsx
│   │   │   │   ├── groups.$groupId_.receipt.tsx  # upload → processing → review → confirm
│   │   │   │   └── invite.$token.tsx    # /invite/:token
│   │   │   ├── components/
│   │   │   │   ├── ui/         # shadcn/ui (Button, Card, Input, Label, Alert)
│   │   │   │   ├── dashboard/  # BalanceBanner, GroupList, GroupCard, GlobalActivityFeed
│   │   │   │   ├── group/      # GroupDetail, ExpenseFeed, BalancesPanel, MembersPanel,
│   │   │   │   │               # SettleUpPanel, InviteLinkButton, ActivityLog,
│   │   │   │   │               # ImportExpensesButton
│   │   │   │   ├── expense/    # AddExpenseForm, SplitModeToggle
│   │   │   │   ├── receipt/    # ReceiptUploadStep, ReceiptProcessingStep,
│   │   │   │   │               # ReceiptLineItemReview (per-item equal/exact/percent/shares)
│   │   │   │   ├── feedback/   # LoadingState, ErrorState
│   │   │   │   └── layout/     # SiteHeader (with ThemeToggle), SiteFooter,
│   │   │   │                   # PendingInvitationsBell
│   │   │   ├── context/        # AuthContext (Supabase session-backed login,
│   │   │   │                   # register, logout), PendingInvitesContext
│   │   │   │                   # (incoming join requests)
│   │   │   ├── lib/            # apiClient (incl. postFileStream for NDJSON uploads),
│   │   │   │                   # computeBalances, receiptSplits, requireAuth,
│   │   │   │                   # supabaseClient, utils
│   │   │   ├── root.tsx        # Root layout + AuthProvider + PendingInvitesProvider
│   │   │   ├── routes.ts       # File-based route config (@react-router/fs-routes)
│   │   │   └── styles.css      # Tailwind + shadcn CSS variables + domain styles
│   │   ├── tailwind.config.js
│   │   ├── vite.config.ts
│   │   └── react-router.config.ts  # ssr: false
│   ├── api/                    # Fastify REST API
│   │   ├── src/
│   │   │   ├── routes/         # auth, groups, expenses, settlements, invites, activities,
│   │   │   │                   # joinRequests, receipts (Gemini OCR + line-item expenses)
│   │   │   ├── middleware/     # requireAuth (verifies Supabase JWT, upserts User),
│   │   │   │                   # requireGroupMember, errorHandler
│   │   │   ├── services/       # balanceService, debtSimplificationService, authService
│   │   │   │                   # (Supabase JWT verification via jose), activityService,
│   │   │   │                   # emailService, exchangeRateService (Frankfurter + DB cache),
│   │   │   │                   # geminiReceiptService (Gemini OCR, retry + model fallback)
│   │   │   ├── generated/     # Prisma 7 generated client
│   │   │   ├── app.ts         # Fastify app factory (buildApp)
│   │   │   └── server.ts      # Entry point (listen)
│   │   ├── prisma/
│   │   │   ├── schema.prisma  # 12 models (User, Group, GroupMember, Expense, ExpenseSplit,
│   │   │   │                  #            Settlement, GroupInvite, Activity, GroupJoinRequest,
│   │   │   │                  #            ExchangeRate, ReceiptLineItem,
│   │   │   │                  #            ReceiptLineItemAssignment)
│   │   │   └── seed.ts
│   │   └── prisma.config.ts   # Prisma 7 config (datasource URL for migrations)
│   ├── web-static/             # M1 HTML/CSS prototype (archive)
│   └── e2e/                    # Playwright E2E tests (auth, dashboard) — mocked GET /api/auth/me
├── packages/
│   └── shared/                 # Zod schemas (group, expense, settlement, receipt)
├── docs/
│   ├── milestones.md           # Criterion-to-code mapping for grading
│   ├── architecture.md         # System, frontend & API architecture diagrams
│   ├── api-reference.md        # Full REST API documentation with examples
│   └── adr/
│       ├── 001-spa-mode.md        # SPA vs SSR decision record
│       ├── 002-debt-simplification.md  # Min-cash-flow algorithm rationale
│       ├── 003-prisma-driver-adapter.md # Prisma 5 → 7 migration
│       ├── 004-supabase-auth.md   # Custom JWT → Supabase Auth (Cloud) migration
│       ├── 005-009-…              # BFF session, server-side splits, RR v8, CSP, pagination
│       ├── 010-multi-currency.md  # Per-expense currency, Frankfurter API, DB rate cache
│       ├── 011-credit-card-fx-markup.md # Per-user/per-expense credit card FX markup
│       └── 012-receipt-ai-parsing.md    # Gemini receipt OCR, line-item split modes
├── docker-compose.yml          # PostgreSQL 16 (development)
├── docker-compose.prod.yml     # Production (Caddy + frontend + API + Postgres)
├── Caddyfile                   # Reverse proxy + automatic HTTPS (Let's Encrypt or local CA)
├── Makefile                    # Local dev (make dev) + remote-deployment workflow (deploy, logs, ps, ...)
└── .github/
    └── workflows/ci.yml        # Lint, typecheck, test-api, test-web, docker-build
```

---

## Getting Started

### Option A — Reproducibly startable via Docker Compose (recommended for grading)

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
  locally-trusted cert — fine for grading. Set `DOMAIN=your-domain.com` (pointed at the
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

### Demo Account

| Email               | Password            | Group                                |
| ------------------- |---------------------|--------------------------------------|
| `demo@even-up.local` | demo                | Ski Trip 2026 (with anna, ben) |

### Running Tests

```bash
# From repo root, per workspace
npm test --workspace=apps/api   # API: auth, expenses, balances, settlements, debt simplification, join requests, exchange rates, receipts, Gemini parsing (94 tests)
npm test --workspace=apps/web   # Frontend: utils, computeBalances, computePerCurrencyBalances, receiptSplits, ExpenseItem, AddExpenseForm, LoadingState, ErrorState, receipt route loader (61 tests)
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
| Join request invite   | `POST /api/groups/:id/members`       | Not sent — invitee only sees it via the bell                |
| Join request accepted | `POST /api/join-requests/:id/accept` | Not sent — inviter only sees it in the group's activity log |

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

The production nginx config (`apps/web/nginx.conf`) already raises the default 1MB
upload limit, proxy timeouts, and disables response buffering on `/api/` specifically
for this feature — no extra config needed on your part unless you've customized that file.

### Logs

The API uses Fastify's built-in logger (pino), enabled in development and production but disabled during tests (`NODE_ENV=test`) to keep test output clean. Each request produces two JSON lines — `incoming request` and `request completed` (with status code and response time):

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

### Health Check

`GET /api/health` returns `{ "status": "ok" }`, no authentication required. Used by the Docker Compose healthcheck for the `api` service; also suitable for external uptime monitoring.

### CI Pipeline

Seven jobs run on every push/PR to `main` or `dev` (`.github/workflows/ci.yml`): a
dependency audit (`npm audit --audit-level=high`), lint + format check, typecheck (both
workspaces, with React Router typegen run first), API tests (against a real Postgres
service container), frontend tests, Playwright E2E tests, and a Docker build + smoke
test that builds the production images, brings the full stack up, and verifies the
public entrypoint actually responds. See [docs/architecture.md](docs/architecture.md)
for the full pipeline diagram.

---

## Roadmap

### M1 — Static Prototype

Semantic HTML/CSS prototype without JavaScript.

- [x] Semantic HTML structure (`header`, `nav`, `main`, `section`, `article`, `footer`)
- [x] Group overview page
- [x] Group detail page (expense list + balances)
- [x] Add expense form with `<label for>` + `name` attributes
- [x] Responsive layout using Flexbox and Grid
- [x] Consistent design tokens (CSS custom properties for colors, typography)
- [x] Mobile-first media query (<=768px breakpoint)
- [x] Clean URL structure documented

### M2 — React SPA with Interaction

Port M1 to React + TypeScript with Vite.

- [x] Vite + React + TypeScript project setup (`strict: true`)
- [x] Component decomposition (layout, dashboard, group, expense, feedback)
- [x] Typed props for data and configuration
- [x] Controlled forms with `useState` (5 form fields)
- [x] `useState` for application data shell (groups, expenses, loading, error)
- [x] `useEffect` for initial data loading
- [x] Split mode switching (equal / exact / percent / shares)
- [x] End-to-end user action: create expense -> list updates -> balances recalculate
- [x] M1 design system ported to React

### M3 — Routing & Data Fetching

React Router with multiple routes and HTTP data fetching.

- [x] React Router setup with >=3 routes (`/`, `/groups/:id`, `/groups/:id/new-expense`)
- [x] Navigation via `<Link>` (no `window.location`)
- [x] `useParams` and `useNavigate` for typed route params and programmatic navigation
- [x] Centralized API client with error class and JWT header injection
- [x] GET requests for groups and expenses
- [x] POST request to create expenses
- [x] DELETE request to remove expenses
- [x] Loading state with `role="status"` accessibility
- [x] Error state with retry button (4xx/5xx + network errors)
- [x] Inline form submit error handling
- [x] Shared application state via React Context (`AppDataProvider`)
- [x] Three route consumers sharing the same data context
- [x] Mock backend via json-server for development

### M4 — Backend, Auth & Testing

Fastify REST API with PostgreSQL, auth, and test coverage.

- [x] Fastify REST API with cors, compression, JSON parsing
- [x] Auth routes (register, login, me)
- [x] JWT auth service (hash, compare, sign, verify)
- [x] Auth middleware (Bearer token -> `req.user`)
- [x] Group membership middleware (403 on non-members)
- [x] Group CRUD endpoints
- [x] Expense CRUD endpoints with automatic split calculation
- [x] Zod input validation on all mutation endpoints
- [x] Centralized error handler (ZodError, HttpError, Prisma errors -> JSON)
- [x] Prisma schema with 6 models (User, Group, GroupMember, Expense, ExpenseSplit, Settlement)
- [x] Database seed with demo data
- [x] Server-side balance computation (integer cents, includes settlements)
- [x] Frontend AuthContext (login, register, logout, token persistence)
- [x] Protected routes with redirect to `/login`
- [x] Login and register pages with error display
- [x] API client wired to real backend with JWT
- [x] Provider hierarchy (StrictMode -> Router -> Auth -> App)
- [x] Settlement endpoints (record payment, suggest transfers)
- [x] Debt simplification service (greedy min-cash-flow algorithm)
- [x] Test: balance computation (net sum = 0, payer credited, rounding)
- [x] Test: auth guard (register -> JWT, wrong password -> 401, no token -> 401, valid -> 200)
- [x] Test: expenses API (no auth -> 401, member POST -> 201)
- [x] Test: frontend components (LoadingState, ErrorState)
- [x] Test: debt simplification (fewer transfers, same net balances)
- [x] Test: settlements API (record settlement, settle-up suggestions, balance impact)

### M5 — Deployment & Polish

Production deployment, architecture migration, and UI polish.

- [x] Docker Compose production setup (API + frontend + Postgres)
- [x] Migrate to React Router v7 file-based routing with clientLoaders (SPA mode — see [ADR 001](docs/adr/001-spa-mode.md))
- [x] Replace custom CSS components with Tailwind CSS + shadcn/ui (Button, Card, Input, Label, Alert)
- [x] Shared Zod schemas in `packages/shared` (group, expense, settlement)
- [x] ESLint + Prettier pre-commit hooks via Husky + lint-staged
- [x] GitHub Actions CI pipeline (lint, typecheck, test-api, test-web, docker-build smoke test)
- [x] Performance: gzip compression, asset cache headers, route-level code splitting
- [x] Create group UI (`/groups/new`)
- [x] Add members to group (by email, on group detail page)
- [x] Empty state on dashboard with CTA to create first group
- [x] `useRevalidator` for live data refresh after member addition
- [x] Delete expense UI (hover button per expense item with confirmation)
- [x] Settlements UI (settle-up flow with debt simplification toggle)
- [x] Expense edit flow (update existing expense)
- [x] Stretch: group invite links (shareable join URL with 7-day expiry)
- [x] Stretch: dark mode (system preference + manual toggle, persisted)
- [x] Stretch: CSV expense import (bulk entry with member-name matching and preview)
- [x] Stretch: activity log per group (relative timestamps, load-more paginated)
- [x] Stretch: password reset — now handled by Supabase Auth's own
      `resetPasswordForEmail`/`updateUser` flow (see [ADR 004](docs/adr/004-supabase-auth.md)),
      superseding the original custom token-based flow
- [x] Stretch: email disambiguation in member/balance panels
- [x] Stretch: group join requests — adding a member by email creates a pending request
      that must be accepted, not an immediate add; header notification bell across all
      pages for incoming requests, with a per-group view of outstanding outgoing invites
- [x] Stretch: signup-confirmation email — now sent by Supabase Auth itself (SMTP-routed
      through the app's Resend account, branded template), superseding the original
      app-side welcome email — see [ADR 004](docs/adr/004-supabase-auth.md)
- [x] Stretch: automatic HTTPS via Caddy reverse proxy (local self-signed cert for
      `DOMAIN=localhost`, real Let's Encrypt certificate for a configured domain)
- [x] Stretch: `make dev` — one-command local dev environment (db + migrate + seed +
      both dev servers, hot reload)

### M6 — Auth Migration: Custom JWT → Supabase Auth

Replaced the M4 custom JWT auth system with Supabase Auth (Cloud), keeping the
self-hosted Postgres + Prisma database for all application data. See
[ADR 004](docs/adr/004-supabase-auth.md) for full rationale.

- [x] Frontend talks to Supabase directly (`@supabase/supabase-js`) for sign-up, login,
      logout, and password reset
- [x] API verifies the Supabase-issued JWT per request (`jose`, JWKS or HS256) instead
      of its own signed tokens
- [x] Lazy `User` provisioning via `prisma.user.upsert()` on first authenticated
      request — no signup webhook needed
- [x] `passwordHash` column and `PasswordResetToken` table dropped; `User.id` is now the
      Supabase Auth UUID
- [x] `/api/auth/register`, `/login`, `/forgot-password`, `/reset-password` removed
      (kept `/me`); app-side `sendWelcomeEmail`/`sendPasswordResetEmail` removed
- [x] Supabase's confirmation/reset emails routed through the existing Resend account
      (custom SMTP) with branded templates — exactly one signup email, not two
- [x] Test suite rewritten to mock JWT verification instead of minting real tokens
- [x] Stretch: multi-currency support — per-expense currency selection (31 ECB currencies),
      historical exchange rates via Frankfurter API, permanent DB cache, original amount
      preserved for display, per-currency balance breakdown toggle; see [ADR 010](docs/adr/010-multi-currency.md)
- [x] Stretch: credit card FX markup — per-user default + per-expense override percentage
      applied on top of the exchange-rate conversion; see [ADR 011](docs/adr/011-credit-card-fx-markup.md)
- [x] Stretch: BFF session management — session moved from `supabase-js`/`localStorage` to
      HttpOnly cookies owned entirely by the Fastify API, closing an XSS token-theft vector;
      see [ADR 005](docs/adr/005-bff-session-management.md)
- [x] Stretch: Google sign-in (server-side PKCE OAuth) and passkey (WebAuthn) login/registration
- [x] Stretch: change password and delete-account self-service in Settings
- [x] Stretch: AI-assisted receipt scanning — Gemini extracts store name/date/line items
      from a photo; review screen assigns items to members with per-item equal/exact/
      percent/shares splits, excludable items, live per-member totals, and a re-editable
      "Edit line items" flow on the resulting expense; see [ADR 012](docs/adr/012-receipt-ai-parsing.md)
- [ ] Stretch: recurring expenses (rent, subscriptions)
- [ ] Stretch: charts and spending statistics per group

---

## Documentation

| Document                                                                 | Description                                                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                                     | System overview, frontend component hierarchy, auth flow, data flow, security model, testing strategy                                         |
| [API Reference](docs/api-reference.md)                                   | Full REST API documentation with request/response examples for every endpoint                                                                 |
| [Milestones](.ai/grading/milestones.md)                                         | Criterion-to-code mapping for each milestone (grading reference)                                                                              |
| [Ausarbeitung](.ai/grading/ausarbeitung.md)                                     | Full written report (Einleitung, Architektur, Umsetzung pro Meilenstein, Deployment, Reflexion); `docs/ausarbeitung.pdf` is the generated PDF |
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

---

## Known Limitations

- No real-time sync — uses `useRevalidator` for manual refresh after mutations
- Split modes beyond "equal" (percentage, shares) are selectable in the UI but not fully wired end-to-end — the API always stores the exact cent amounts calculated at submission
- Deleting a user in Supabase Auth does not cascade to the local `User` row or its relations — an accepted gap, not handled via a Database Webhook (see [ADR 004](docs/adr/004-supabase-auth.md))
- No mobile app — responsive web only
- Duplicate-join-request prevention is enforced at the application level (a check-then-create), not via a database constraint — a small race window exists where two concurrent invites to the same person could both succeed
- CORS is restricted to `CORS_ORIGIN` env var (defaults to `localhost:5173/4173/5174/4174` for local dev); allowed methods include `PATCH` explicitly

---

## License

University semester project — not licensed for distribution.

# EvenUp

A web application for splitting expenses fairly among groups. Create groups for your flatshare, trips, or events, log shared expenses, and let EvenUp calculate who owes whom — with optional debt simplification to minimize the number of transfers.

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
- **Multi-currency** — choose any of 31 currencies (ECB/Frankfurter API) per expense; the API converts to the group's base currency using the historical exchange rate for the expense date; rates are cached permanently in the DB; original amount and currency are always stored for display
- Group currency toggle: view balances either converted to the group's base currency or broken down per original currency
- Preferred currency is saved per user account and used when creating a new group
- Select how the cost is split:
  - **Equal** — evenly among all members
  - **Exact** — specific amounts per person
  - **Percentage** — percentage-based split
  - **Shares** — weighted shares (e.g. 2:1:1)

### Balances & Settlements

- Real-time net balance per person within each group
- "Settle up" flow to record payments
- **Debt simplification** — reduces the number of required transfers without changing anyone's net balance (min-cash-flow algorithm)

### Authentication & Account

- Email/password registration and login via **Supabase Auth** (Cloud) — the frontend
  talks to Supabase directly; the API verifies the Supabase-issued JWT per request
- Local `User` row is lazily provisioned (`upsert`) on the first authenticated request
  for a given Supabase user — no signup webhook needed
- Protected routes on both client (loader-level redirect) and server (Fastify preHandler)
- Password reset and signup-confirmation emails are sent by Supabase itself, routed
  through the app's existing Resend account (custom SMTP) with branded templates — see
  [ADR 004](docs/adr/004-supabase-auth.md)

### UI & Quality of Life

- Dark mode (system preference detected on load, manual toggle persisted to localStorage)
- CSV import for bulk expense entry (column-based, name matching, preview before import)
- Activity log per group with load-more pagination (expenses added/edited/deleted, settlements, members joined)
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
| **Auth**                | Supabase Auth (Cloud) — JWT verified server-side via `jose`/JWKS                              |
| **Database**            | PostgreSQL 16 + Prisma 7 ORM (`@prisma/adapter-pg`)                                           |
| **Email**               | Resend (join-request emails; Supabase's auth emails are SMTP-routed through the same account) |
| **Reverse Proxy / TLS** | Caddy (automatic Let's Encrypt HTTPS in production)                                           |
| **Testing**             | Vitest, React Testing Library, Fastify `app.inject()`                                         |
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
                 |  HTTP/JSON (HttpOnly cookies)
                 v
+----------------+-------------------------+
|           Fastify REST API               |
|  Zod request validation (shared schemas) |
|  requireAuth: verifies Supabase JWT,     |
|   lazily upserts local User row          |
|  Route modules: auth, groups, expenses,  |
|   settlements, invites, activities,      |
|   join-requests                          |
+----------------+-------------------------+
                 |
                 |  Prisma ORM
                 v
+----------------+-------------------------+
|            PostgreSQL 16                 |
|  User, Group, GroupMember, Expense       |
|  ExpenseSplit, Settlement, GroupInvite   |
|  Activity, GroupJoinRequest              |
+------------------------------------------+
  Supabase Cloud: auth.users (credentials,
  sessions) separate from this database
```

### Why SPA over SSR?

EvenUp is a fully authenticated, interactive application. Every view depends on the logged-in user's data. Server-side rendering adds complexity without SEO benefit here. A client-side SPA with Supabase Auth and Fastify as a dedicated API layer is the simplest architecture that fits the problem. See [ADR 001](docs/adr/001-spa-mode.md) for full rationale.

### Shared Validation

Zod schemas live in a shared `packages/shared` workspace. Both the React Router loaders (client-side) and Fastify route handlers (server-side) import the same schemas — a single source of truth for what constitutes a valid expense, group, or settlement.

---

## Data Model

All monetary values are stored as **integer cents** to avoid floating-point rounding errors.

| Entity               | Key Fields                                                                   |
| -------------------- | ---------------------------------------------------------------------------- |
| **User**             | id (Supabase Auth user id), name, email, preferredCurrency, createdAt        |
| **Group**            | id, name, currency (base currency), createdAt, updatedAt                     |
| **GroupMember**      | groupId, userId, role                                                        |
| **Expense**          | id, groupId, paidByUserId, description, amountCents (converted to group currency), originalAmountCents, originalCurrency, splitMode, date |
| **ExpenseSplit**     | expenseId, userId, owedCents                                                 |
| **Settlement**       | id, groupId, fromUserId, toUserId, amountCents, date, note?                  |
| **GroupInvite**      | id, token (unique), groupId, createdBy, expiresAt                            |
| **Activity**         | id, groupId, userId, type, data (JSON), createdAt                            |
| **GroupJoinRequest** | id, groupId, invitedUserId, invitedByUserId, status, createdAt, respondedAt? |
| **ExchangeRate**     | id, date, fromCurrency, toCurrency, rate (unique on date+from+to — permanent cache) |

Credentials and password-reset tokens live entirely in Supabase Auth's own `auth.users`
table (managed by Supabase, separate from this database) — there is no `passwordHash`
or password-reset-token table in this app's schema.

---

## API Endpoints

### Auth

Sign-up, login, logout, and password reset go directly from the frontend to Supabase
Auth via `@supabase/supabase-js` — they're not API endpoints. The API only verifies the
resulting JWT (`requireAuth`) and exposes:

| Method | Path             | Description                                 |
| ------ | ---------------- | ------------------------------------------- |
| GET    | `/api/auth/me`   | Current user profile (this DB's view of it) |
| PATCH  | `/api/auth/me`   | Update name, language, or preferred currency |

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
| POST   | `/api/groups/:id/expenses`      | Create expense with splits (optional `currency` field triggers conversion) |
| GET    | `/api/groups/:id/expenses/:eid` | Single expense (used by edit route) |
| PUT    | `/api/groups/:id/expenses/:eid` | Update expense (optional `currency` field triggers conversion) |
| DELETE | `/api/groups/:id/expenses/:eid` | Delete expense             |

### Settlements

| Method | Path                                      | Description         |
| ------ | ----------------------------------------- | ------------------- |
| GET    | `/api/groups/:id/settle-up?simplify=true` | Suggested transfers |
| POST   | `/api/groups/:id/settlements`             | Record a settlement |

### Invites

| Method | Path                         | Description                         |
| ------ | ---------------------------- | ----------------------------------- |
| POST   | `/api/groups/:id/invites`    | Generate invite link (7-day expiry) |
| POST   | `/api/invites/:token/accept` | Accept invite and join group        |

### Activities

| Method | Path                         | Description                         |
| ------ | ---------------------------- | ----------------------------------- |
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
│   │   │   │   ├── groups.new.tsx       # /groups/new
│   │   │   │   ├── groups.$groupId.tsx  # /groups/:id
│   │   │   │   ├── groups.$groupId_.new-expense.tsx
│   │   │   │   ├── groups.$groupId_.expenses.$expenseId.edit.tsx
│   │   │   │   └── invite.$token.tsx    # /invite/:token
│   │   │   ├── components/
│   │   │   │   ├── ui/         # shadcn/ui (Button, Card, Input, Label, Alert)
│   │   │   │   ├── dashboard/  # BalanceBanner, GroupList, GroupCard
│   │   │   │   ├── group/      # GroupDetail, ExpenseFeed, BalancesPanel, MembersPanel,
│   │   │   │   │               # SettleUpPanel, InviteLinkButton, ActivityLog,
│   │   │   │   │               # ImportExpensesButton
│   │   │   │   ├── expense/    # AddExpenseForm, SplitModeToggle
│   │   │   │   ├── feedback/   # LoadingState, ErrorState
│   │   │   │   └── layout/     # SiteHeader (with ThemeToggle), SiteFooter,
│   │   │   │                   # PendingInvitationsBell
│   │   │   ├── context/        # AuthContext (Supabase session-backed login,
│   │   │   │                   # register, logout), PendingInvitesContext
│   │   │   │                   # (incoming join requests)
│   │   │   ├── lib/            # apiClient, computeBalances, requireAuth,
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
│   │   │   │                   # joinRequests
│   │   │   ├── middleware/     # requireAuth (verifies Supabase JWT, upserts User),
│   │   │   │                   # requireGroupMember, errorHandler
│   │   │   ├── services/       # balanceService, debtSimplificationService, authService
│   │   │   │                   # (Supabase JWT verification via jose), activityService,
│   │   │   │                   # emailService, exchangeRateService (Frankfurter + DB cache)
│   │   │   ├── generated/     # Prisma 7 generated client
│   │   │   ├── app.ts         # Fastify app factory (buildApp)
│   │   │   └── server.ts      # Entry point (listen)
│   │   ├── prisma/
│   │   │   ├── schema.prisma  # 10 models (User, Group, GroupMember, Expense, ExpenseSplit,
│   │   │   │                  #            Settlement, GroupInvite, Activity, GroupJoinRequest,
│   │   │   │                  #            ExchangeRate)
│   │   │   └── seed.ts
│   │   └── prisma.config.ts   # Prisma 7 config (datasource URL for migrations)
│   └── web-static/             # M1 HTML/CSS prototype (archive)
├── packages/
│   └── shared/                 # Zod schemas (group, expense, settlement)
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
│       └── 010-multi-currency.md  # Per-expense currency, Frankfurter API, DB rate cache
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
| `demo@evenup.local` | demo                | Ski Trip 2026 (with anna, ben) |

### Running Tests

```bash
# All tests from repo root
npm test

# Or individually
cd apps/api && npm test         # API: auth, expenses, balances, settlements, debt simplification, join requests, exchange rates (65 tests)
cd apps/web && npm test         # Frontend: utils, computeBalances, computePerCurrencyBalances, ExpenseItem, LoadingState, ErrorState (41 tests)
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
   EMAIL_FROM=EvenUp <noreply@your-domain.com>
   APP_URL=https://your-domain.com
   ```
3. `make deploy`.

### Logs

The API uses Fastify's built-in logger (pino), enabled in development and production but disabled during tests (`NODE_ENV=test`) to keep test output clean. Each request produces two JSON lines — `incoming request` and `request completed` (with status code and response time):

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

### Health Check

`GET /api/health` returns `{ "status": "ok" }`, no authentication required. Used by the Docker Compose healthcheck for the `api` service; also suitable for external uptime monitoring.

### CI Pipeline

Five jobs run on every push/PR to `main` (`.github/workflows/ci.yml`): lint, typecheck (both workspaces, with React Router typegen run first), API tests (against a real Postgres service container), frontend tests, and a Docker build + smoke test that builds the production images, brings the full stack up, and verifies the public entrypoint actually responds. See [docs/architecture.md](docs/architecture.md) for the full pipeline diagram.

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
- [ ] Stretch: recurring expenses (rent, subscriptions)
- [ ] Stretch: receipt photo upload
- [ ] Stretch: charts and spending statistics per group

---

## Documentation

| Document                                                                 | Description                                                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                                     | System overview, frontend component hierarchy, auth flow, data flow, security model, testing strategy                                         |
| [API Reference](docs/api-reference.md)                                   | Full REST API documentation with request/response examples for all 20 endpoints                                                               |
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

---

## Known Limitations

- No real-time sync — uses `useRevalidator` for manual refresh after mutations
- Split modes beyond "equal" (percentage, shares) are selectable in the UI but not fully wired end-to-end — the API always stores the exact cent amounts calculated at submission
- Deleting a user in Supabase Auth does not cascade to the local `User` row or its relations — an accepted gap, not handled via a Database Webhook (see [ADR 004](docs/adr/004-supabase-auth.md))
- No mobile app — responsive web only
- Duplicate-join-request prevention is enforced at the application level (a check-then-create), not via a database constraint — a small race window exists where two concurrent invites to the same person could both succeed
- CORS allows all origins (`@fastify/cors` registered with no options) — not yet restricted to the frontend's own domain

---

## License

University semester project — not licensed for distribution.

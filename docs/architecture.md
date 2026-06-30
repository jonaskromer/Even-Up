# Architecture Overview

## System Architecture

EvenUp follows a **client-server SPA architecture** with a clear separation between the React frontend and the Fastify REST API. Both communicate exclusively via JSON over HTTP.

```
┌─────────────────────────────────────────────────┐
│                  Browser (SPA)                  │
│                                                 │
│  React Router 8 (SPA mode, file-based routing)  │
│  clientLoaders for per-route data fetching      │
│  AuthContext (Supabase session) +                │
│  PendingInvitesContext for join-request          │
│  notifications                                   │
│  Tailwind CSS + shadcn/ui components            │
│  Zod schemas (shared with API)                  │
└────────────────────┬────────────────────────────┘
                     │ fetch() + credentials:'include'
                     │ (HttpOnly cookie session — no token in JS)
                     │
┌────────────────────▼────────────────────────────┐
│              Fastify REST API (BFF)             │
│                                                 │
│  Auth: login/register/logout/refresh/google/    │
│        callback/exchange/forgot-password/me/    │
│        patch-me/change-password/delete-me       │
│  sb_access (1h) + sb_refresh (30d) HttpOnly     │
│  Middleware: requireAuth → requireGroupMember    │
│   (cookie-first → JWKS verify → auto-refresh)   │
│  Validation: Zod schemas (shared with frontend) │
│  Services: authService, balance, debt,          │
│            activity, email                      │
│  Error handler: ZodError, HttpError, Prisma     │
│                 ↕ JWKS                          │
│              Supabase Auth (Cloud)              │
└────────────────────┬────────────────────────────┘
                     │ Prisma 7 + @prisma/adapter-pg
                     │
┌────────────────────▼────────────────────────────┐
│              PostgreSQL 16                      │
│                                                 │
│  9 tables, integer cents for all monetary vals  │
│  Cascade deletes on group → expenses/members/   │
│  join-requests                                  │
│  (credentials live in Supabase's own auth.users, │
│   not here — see ADR 004)                        │
└─────────────────────────────────────────────────┘
```

## Frontend Architecture

### Routing Strategy

React Router v8 in SPA mode with `@react-router/fs-routes` for file-based route discovery. Each route file can export a `clientLoader` that fetches data before the component renders — replacing the previous global `AppDataContext` pattern.

```
routes/
├── _index.tsx                                     # / (dashboard)
├── login.tsx                                      # /login (Supabase signInWithPassword)
├── register.tsx                                   # /register (Supabase signUp)
├── forgot-password.tsx                            # /forgot-password (Supabase resetPasswordForEmail)
├── reset-password.tsx                             # /reset-password (Supabase updateUser)
├── groups.new.tsx                                 # /groups/new
├── groups.$groupId.tsx                            # /groups/:groupId
├── groups.$groupId_.new-expense.tsx               # /groups/:groupId/new-expense
├── groups.$groupId_.expenses.$expenseId.edit.tsx  # /groups/:groupId/expenses/:expenseId/edit
└── invite.$token.tsx                              # /invite/:token
```

The `_` suffix in `$groupId_` is a flatRoutes convention that prevents child nesting. Without it, `new-expense` would render inside `groups.$groupId`'s `<Outlet />` instead of as a standalone page.

### Auth Flow (BFF Pattern)

All auth is handled through the Fastify BFF. The browser never sees a token — only opaque HttpOnly cookies. See [ADR 005](adr/005-bff-session-management.md).

```
Browser                    Fastify BFF                  Supabase Auth
  │                             │                             │
  │ POST /api/auth/login        │                             │
  │ {email, password}           │                             │
  │────────────────────────────►│                             │
  │                             │ POST /auth/v1/token         │
  │                             │─────────────────────────────►
  │                             │◄─────────────────────────────
  │                             │ {access_token, refresh_token}
  │ Set-Cookie: sb_access (1h)  │                             │
  │ Set-Cookie: sb_refresh (30d)│                             │
  │◄────────────────────────────│                             │
  │                             │                             │
  │ GET /api/groups (cookie)    │                             │
  │────────────────────────────►│                             │
  │                             │ requireAuth:                │
  │                             │  read sb_access cookie      │
  │                             │  verify JWT via JWKS        │
  │                             │  (local, no network hit)    │
  │                             │  upsert User row            │
  │◄────────────────────────────│                             │
  │ 200 {groups: [...]}         │                             │
```

**Google OAuth (server-side PKCE):**

```
Browser                    Fastify BFF                  Supabase Auth / Google
  │                             │                             │
  │ GET /api/auth/google        │                             │
  │────────────────────────────►│ generate PKCE verifier      │
  │                             │ store as HttpOnly cookie    │
  │ 302 → Supabase OAuth URL   │──────────────────────────────────────►
  │◄────────────────────────────│                             │
  │ (browser redirects to Google — user logs in)
  │                             │                             │
  │ GET /api/auth/callback?code=│                             │
  │────────────────────────────►│ read pkce_verifier cookie   │
  │                             │ exchange code+verifier      │
  │                             │──────────────────────────────────────►
  │                             │◄──────────────────────────────────────
  │ Set-Cookie: sb_access       │ {access_token, refresh_token}
  │ Set-Cookie: sb_refresh      │                             │
  │ 302 → /                    │                             │
  │◄────────────────────────────│                             │
```

**Session lifecycle:**

1. Login/register: browser posts credentials to `POST /api/auth/login` (or `/register`). Fastify calls Supabase REST directly and sets `sb_access` (1h TTL) + `sb_refresh` (30d TTL) as `HttpOnly; Secure; SameSite=Lax` cookies.
2. Every subsequent API request sends the cookies automatically (browser manages them). `requireAuth` reads `sb_access`, verifies the JWT via JWKS — no network call to Supabase per request.
3. If `sb_access` is expired but `sb_refresh` is present, `requireAuth` transparently refreshes the session and sets new cookies. The client sees a normal `200`.
4. `AuthContext` on the frontend calls `GET /api/auth/me` once on mount to hydrate the `user` object. It never calls Supabase JS SDK auth methods for login/logout (those go through the BFF).
5. Logout: `POST /api/auth/logout` clears both cookies server-side.
6. `supabase-js` on the frontend is configured with `persistSession: false, autoRefreshToken: false, detectSessionInUrl: false` — it never writes to localStorage.

### Component Hierarchy

```
root.tsx
├── AuthProvider (session state)
│   └── PendingInvitesProvider (incoming join requests, see PendingInvitesContext)
├── <Outlet /> (active route)
│   ├── _index → SiteHeader + Dashboard
│   │             │            ├── BalanceBanner
│   │             │            └── GroupList → GroupCard[]
│   │             └── PendingInvitationsBell (consumes PendingInvitesContext)
│   ├── groups.$groupId → GroupDetail (own inline header, not SiteHeader)
│   │                       ├── PendingInvitationsBell (in GroupDetail's own header)
│   │                       ├── ExpenseFeed → ExpenseItem[] + ImportExpensesButton
│   │                       ├── BalancesPanel
│   │                       ├── SettleUpPanel
│   │                       ├── MembersPanel + InviteLinkButton + AddMemberForm
│   │                       │              (+ pending outgoing invites section)
│   │                       └── ActivityLog
│   ├── groups.$groupId_.new-expense → AddExpenseForm
│   ├── groups.$groupId_.expenses.$expenseId.edit → AddExpenseForm (with defaults)
│   └── invite.$token → (auto-accept invite)
└── SiteFooter
```

### Data Flow

Each route owns its data via `clientLoader`. Mutations (create expense, add member, record settlement, delete expense) trigger `useRevalidator().revalidate()` to re-run the loader, keeping the UI consistent without manual state management.

```
clientLoader() ──fetch──► API ──Prisma──► DB
       │
       ▼
  loaderData (passed to component as prop)
       │
       ▼
  User action (form submit, button click)
       │
       ▼
  api.post/put/delete ──► API ──► DB
       │
       ▼
  revalidator.revalidate() ──► clientLoader() re-runs
```

**Load-more pagination (Expenses / Activities):**

The `clientLoader` fetches only the first page (`?limit=20&offset=0`), passing `items` and
`total` as props. Components accumulate additional pages in local `extra` state when the
user clicks "Load more". On revalidation (after a CRUD mutation), the `key` prop on
`<ExpenseFeed>` and `<ActivityLog>` changes (keyed by `total` + first-item `id`), causing
React to remount those components and reset their `extra` state back to empty — so the
view always starts clean from the loader's fresh first page.

## API Architecture

### Middleware Pipeline

Every request passes through middleware in this order:

```
Request
  │
  ▼
CORS (restricted to `CORS_ORIGIN` env var; defaults to localhost:5173/4173/5174/4174 in development; explicit methods list includes PATCH)
  │
  ▼
Compression (gzip)
  │
  ▼
Route matching
  │
  ▼
requireAuth (verify Supabase JWT, upsert + attach req.user)
  │
  ▼
requireGroupMember (check GroupMember table, 403 if not member)
  │
  ▼
Route handler (Zod validation → business logic → Prisma query)
  │
  ▼
Error handler (catches ZodError → 400, HttpError → status, Prisma P2002 → 409, P2025 → 404, else → 500)
  │
  ▼
Response
```

### Balance Computation

Balances are computed server-side from three data sources:

```
                 ┌─────────────┐
                 │   Expenses   │
                 │              │
                 │ payer gets   │
                 │ +amountCents │
                 │              │
                 │ each split   │
                 │ gets         │
                 │ −owedCents   │
                 └──────┬───────┘
                        │
Net balance =           │   ┌──────────────┐
  Σ paid               ─┼──►│  Net Map     │
  − Σ owed              │   │  per member  │
  + Σ settlements sent  │   └──────┬───────┘
  − Σ settlements recv  │          │
                        │          ▼
                 ┌──────┴───────┐  Balance[]
                 │ Settlements  │  { userId, name, netCents }
                 │              │
                 │ sender gets  │
                 │ +amountCents │
                 │              │
                 │ receiver gets│
                 │ −amountCents │
                 └──────────────┘
```

All monetary values are stored as **integer cents** to avoid floating-point rounding errors. The `formatEuro()` utility converts cents to display format (`1234` → `12,34 €`).

## Shared Validation

Zod schemas in `packages/shared` are the single source of truth for request validation:

```
packages/shared/
└── src/schemas/
    ├── expense.ts     # createExpenseSchema (+ SplitMode type, optional exactSplits for CSV import)
    ├── group.ts       # createGroupSchema, addMemberSchema
    └── settlement.ts  # createSettlementSchema
```

Auth no longer has shared schemas here — sign-up/login/password-reset payloads are
validated by Supabase itself, and the one remaining server-side check (the
client-supplied `user_metadata.name` claim) is a small local schema inline in
`requireAuth.ts`, not worth sharing with the frontend.

Both the API (server-side `schema.parse(req.body)`) and the frontend (type imports for form state) consume these schemas. This guarantees that a form that passes client-side validation will also pass server-side validation.

## Security Model

| Layer                                | Mechanism                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Password storage**                 | Owned by Supabase Auth (Cloud) — this app never sees or stores a password                                                                                                                                                 |
| **Session tokens**                   | HttpOnly cookies (`sb_access` 1h, `sb_refresh` 30d) — never accessible from JavaScript. JWT in `sb_access` verified via `jose`/JWKS; no per-request network call to Supabase.                                             |
| **Route protection (client)**        | `requireAuth()` in every `clientLoader` — calls `GET /api/auth/me`, returns the full `AuthUser` (including `defaultMarkupRate`) for deterministic loader data; throws `redirect('/login')` on 401                         |
| **Route protection (server)**        | `requireAuth` Fastify preHandler — verifies the Supabase JWT, lazily upserts the local `User` row, attaches `req.user`                                                                                                    |
| **Authorization**                    | `requireGroupMember` preHandler — checks `GroupMember` table, throws 403                                                                                                                                                  |
| **Input validation**                 | Zod `.parse()` on all mutation endpoints — rejects malformed input before DB access                                                                                                                                       |
| **Client-supplied claim validation** | `user_metadata.name` from the JWT is validated (and falls back to the email's local part) before being written to the DB — a valid signature only proves the issuer is genuine, not that the claim content is well-formed |
| **Error isolation**                  | Centralized `errorHandler` — never leaks stack traces or internal details to the client                                                                                                                                   |
| **Invite tokens**                    | Cryptographically random (cuid), 7-day TTL, checked server-side on accept                                                                                                                                                 |
| **Password reset**                   | Owned by Supabase Auth's own `resetPasswordForEmail`/`updateUser` flow — no token table in this app's schema                                                                                                              |
| **Join request authorization**       | Only the invited user (`invitedUserId === req.user.id`) may accept/decline a request — checked on every accept/decline call                                                                                               |
| **Email delivery**                   | Supabase's confirmation/reset emails are SMTP-routed through the app's Resend account with branded templates — exactly one signup email, not a separate app-side one                                                      |

## Testing Strategy

### API Tests (67 tests, Vitest + `app.inject()`)

The API tests use Fastify's `app.inject()` method for in-process HTTP testing — no network layer, no port binding, no supertest dependency.

| Suite                        | Tests | What it verifies                                                                                                                                                                   |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.test.ts`               | 9     | GET /me (bearer + cookie), DELETE /me, lazy `User` upsert on first request, PATCH /me (name, preferredCurrency, validation)                                                        |
| `balance.test.ts`            | 3     | Net sum = 0 invariant, payer credited correctly, cent rounding                                                                                                                     |
| `computeSplits.test.ts`      | 8     | Equal mode ignores client splits, exact/percent/shares validation, rounding tolerance, outsider/duplicate userId rejected                                                           |
| `debtSimplification.test.ts` | 6     | Fewer transfers than naive, net balances preserved, edge cases (zero balance, single debtor, 4+ people)                                                                            |
| `exchangeRate.test.ts`       | 5     | Same currency → 1, DB cache hit, Frankfurter v2 fetch + upsert, v1 fallback when v2 fails, 503 when both fail                                                                     |
| `expenses.test.ts`           | 11    | POST (401, create with original fields, exactSplits, markupRate applied), PUT (update splits, 409 stale conflict), GET single (401, fields, 404), DELETE (401, removes expense)    |
| `groups.test.ts`             | 7     | GET /groups (401, array), POST (creator as owner, currency field, defaults EUR, inherits preferredCurrency), GET /:id (member + non-member), GET /:id/balances                    |
| `joinRequests.test.ts`       | 7     | Invite creates pending request, duplicate/self-invite rejected, accept/decline, wrong-user accept → 403, re-invite after accept → 409                                              |
| `settlements.test.ts`        | 4     | Record settlement → 201, 401 without auth, settle-up suggestions, balance zeroed after settlement                                                                                 |

### Frontend Tests (43 tests, Vitest + React Testing Library)

| Suite                                    | Tests | What it verifies                                                                                         |
| ---------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `lib/utils.test.ts`                      | 8     | `formatCurrency` for EUR, USD, CHF, JPY, zero, negative, large amounts                                  |
| `lib/computeBalances.test.ts`            | 12    | `formatEuro` formatting, payer credited, other-group ignored, 3-member net, multi-expense, rounding      |
| `lib/computePerCurrencyBalances.test.ts` | 7     | Empty input, single-currency net=0, payer credited in original currency, 50/50 USD, two-currency buckets |
| `components/group/ExpenseItem.test.tsx`  | 10    | Description rendered, you-paid vs payer-name label, `showConverted` toggle, secondary currency shown/hidden, markup hint shown/hidden |
| `components/feedback/LoadingState.test.tsx` | 3  | Default label, custom label, `role="status"` for accessibility                                           |
| `components/feedback/ErrorState.test.tsx`   | 3  | Renders message, retry button fires callback, no button without `onRetry`                                |

### CI Pipeline (GitHub Actions)

Seven parallel jobs run on every push and PR to `main`:

```
┌──────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐
│  Audit   │  │   Lint   │  │ Type Check │  │ API Tests │  │ Web Tests │  │ E2E Tests │  │ Docker Build │
│ npm audit│  │ ESLint   │  │ tsc api    │  │ Postgres  │  │ jsdom     │  │ Playwright│  │  & Smoke     │
│ --level= │  │ Prettier │  │ tsc web    │  │ service   │  │ env       │  │ Chromium  │  │ build, up,   │
│ high     │  │          │  │ typegen    │  │ Vitest    │  │ Vitest    │  │           │  │ curl health  │
└──────────┘  └──────────┘  └────────────┘  └───────────┘  └───────────┘  └───────────┘  └──────────────┘
```

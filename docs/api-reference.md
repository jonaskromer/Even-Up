# API Reference

Base URL: `http://localhost:4000` (development). In production (Docker Compose), the API
has no published port — it's only reachable through Caddy → nginx's `/api/*` proxy at
the same origin as the frontend (e.g. `https://your-domain.com/api/...`), which is why
the frontend client never needs a configured API URL there.

All endpoints return JSON. All mutation endpoints validate input with Zod schemas from `@evenup/shared`. Monetary values are always in **integer cents**.

---

## Health

### GET `/api/health`

Liveness probe, no authentication required. Used by the Docker Compose healthcheck for the `api` service.

**Response `200`:**

```json
{ "status": "ok" }
```

---

## Authentication

All auth is managed by the Fastify BFF. The browser communicates only via HttpOnly cookies — no token is ever accessible from JavaScript. See [ADR 005](adr/005-bff-session-management.md) for the full design.

All auth endpoints are rate-limited (values shown per endpoint). Cookie names: `sb_access` (1h TTL, JWT), `sb_refresh` (30d TTL).

### POST `/api/auth/register`

Register a new account. Creates the Supabase Auth user and, if email confirmation is disabled, immediately sets session cookies.

**Rate limit:** 5 req/min

**Request body:**

```json
{ "name": "Max Mustermann", "email": "max@example.com", "password": "secret123", "lang": "de" }
```

**Response `200`:**

```json
{ "needsEmailConfirmation": false }
```

If email confirmation is required: `{ "needsEmailConfirmation": true }` — no cookies set yet.

**Errors:** `422` email already registered or Supabase signup error

---

### POST `/api/auth/login`

Email/password login. Sets `sb_access` and `sb_refresh` cookies on success.

**Rate limit:** 10 req/min

**Request body:**

```json
{ "email": "max@example.com", "password": "secret123" }
```

**Response `200`:**

```json
{ "ok": true }
```

**Errors:** `401` invalid credentials

---

### POST `/api/auth/logout`

Clear session cookies. Requires an authenticated session.

**Rate limit:** 20 req/min

**Response `204`:** No content

---

### POST `/api/auth/refresh`

Refresh the access token using the `sb_refresh` cookie. Sets new `sb_access` and `sb_refresh` cookies.

**Rate limit:** 30 req/min

**Response `200`:**

```json
{ "ok": true }
```

**Errors:** `401` no refresh cookie or session expired (also clears cookies)

---

### GET `/api/auth/google`

Initiates server-side PKCE OAuth flow for Google sign-in. Generates a PKCE verifier, stores it as an HttpOnly cookie (`pkce_verifier`, 10min), and redirects to the Supabase Google OAuth URL.

**Rate limit:** 20 req/min

**Response:** `302` redirect to Supabase OAuth URL

---

### GET `/api/auth/callback`

OAuth PKCE callback (called by Supabase after Google login). Reads `pkce_verifier` cookie and the `?code=` query parameter, exchanges them for tokens, and sets session cookies.

**Rate limit:** 20 req/min

**Response:** `302` redirect to `/` on success, `/login?error=oauth_failed` on failure

---

### POST `/api/auth/exchange`

Exchange a client-side token pair (e.g., from passkey sign-in) for HttpOnly session cookies. Verifies the `access_token` before accepting it.

**Rate limit:** 10 req/min

**Request body:**

```json
{ "access_token": "eyJ...", "refresh_token": "abc..." }
```

**Response `200`:**

```json
{ "ok": true }
```

**Errors:** `401` invalid token

---

### POST `/api/auth/forgot-password`

Send a password-reset email via Supabase. Always returns `200` regardless of whether the email exists (no user enumeration).

**Rate limit:** 3 req/10min

**Request body:**

```json
{ "email": "max@example.com" }
```

**Response `200`:**

```json
{ "ok": true }
```

---

### GET `/api/auth/session-tokens`

Return the current session tokens from HttpOnly cookies in the response body. Used exclusively for WebAuthn passkey enrollment (the Supabase JS SDK must temporarily hold a live session for the WebAuthn ceremony). Requires authentication.

**Rate limit:** 10 req/min

**Response `200`:**

```json
{ "access_token": "eyJ...", "refresh_token": "abc..." }
```

**Errors:** `401` no active session

---

### GET `/api/auth/me`

Return the current user profile. On the first authenticated request for a given Supabase user, the local `User` row is lazily created (`upsert`, keyed on the token's `sub`).

**Rate limit:** 60 req/min

**Response `200`:**

```json
{
  "user": { "id": "9f2b...", "email": "max@example.com", "name": "Max Mustermann", "defaultMarkupRate": 1.5 }
}
```

`defaultMarkupRate` is the user's saved credit card FX markup percentage (0 = no markup). Pre-filled in the expense form when creating or editing a foreign-currency expense.

**Errors:** `401` no valid session cookie

---

### PATCH `/api/auth/me`

Update display name, language preference, and/or preferred currency. Also syncs name and lang to Supabase `user_metadata` so email templates can use them.

**Rate limit:** 20 req/min

**Request body** (at least one field required):

```json
{ "name": "Max M.", "lang": "en", "preferredCurrency": "USD", "defaultMarkupRate": 1.5 }
```

`preferredCurrency` must be a 3-letter ISO 4217 code (e.g. `"EUR"`, `"USD"`, `"JPY"`). It is stored on the local `User` row and used as the default currency when the user creates a new group.

`defaultMarkupRate` is a number between 0 and 100 (percentage). Stored on the `User` row and pre-filled in the expense form when creating or editing a foreign-currency expense.

**Response `200`:**

```json
{ "user": { "id": "9f2b...", "email": "max@example.com", "name": "Max M.", "defaultMarkupRate": 1.5 } }
```

Returned only if the request updated at least one field stored on the local `User` row
(`name`, `preferredCurrency`, `defaultMarkupRate`). A request that only sets `lang`
(synced to Supabase `user_metadata`, not stored locally) returns **`204`** with no body.

---

### POST `/api/auth/change-password`

Change the authenticated user's password by calling Supabase Auth with the current session token.

**Rate limit:** 10 req/min

**Request body:**

```json
{ "password": "newSecret456" }
```

**Response `200`:**

```json
{ "ok": true }
```

**Errors:** `400` weak password, `401` not authenticated

---

### DELETE `/api/auth/me`

Delete the authenticated user's account and all their data. Fails with `409` if the user has created expenses or settlements that other members depend on.

**Rate limit:** 5 req/min

**Response `204`:** No content

**Errors:** `409` user has shared financial records

---

## Groups

All group endpoints require an authenticated session (cookie).

### GET `/api/groups`

List all groups the authenticated user is a member of.

**Response `200`:**

```json
[
  {
    "id": "clx...",
    "name": "Ski Trip 2026",
    "currency": "EUR",
    "members": [
      { "id": "clx...", "name": "Demo User", "email": "demo@even-up.local", "role": "owner" },
      { "id": "clx...", "name": "Anna", "email": "anna@even-up.local", "role": "member" }
    ]
  }
]
```

### POST `/api/groups`

Create a new group. The authenticated user becomes the owner. The group's base `currency` is set from the creator's `preferredCurrency` (defaults to `"EUR"` if none is set).

**Request body:**

```json
{ "name": "WG Sonnenstraße" }
```

**Response `201`:** Group object (same shape as GET)

### GET `/api/groups/:id`

Get a single group with its members. Requires group membership.

**Response `200`:** Group object (includes `currency` field)

**Errors:** `403` not a member, `404` group not found

### POST `/api/groups/:id/members`

Invite a user to the group by email. The user must already have an account. This does
**not** add them directly — it creates a pending `GroupJoinRequest` that the invited
user must accept (see [Join Requests](#join-requests) below) before becoming a member.

**Request body:**

```json
{ "email": "anna@even-up.local" }
```

**Response `201`:**

```json
{ "message": "Anfrage gesendet" }
```

**Errors:** `400` inviting yourself, `404` user not found, `409` already a member or a
request is already pending for this user.

If `RESEND_API_KEY` is configured, the invited user gets an email notifying them of the
invite, fire-and-forget — it never delays or fails this response. Send failures are
logged server-side only.

### GET `/api/groups/:id/balances`

Compute net balances for all members in the group. Accounts for all expenses and settlements.

**Response `200`:**

```json
[
  { "userId": "clx...", "name": "Demo User", "netCents": 1500 },
  { "userId": "clx...", "name": "Anna", "netCents": -800 },
  { "userId": "clx...", "name": "Ben", "netCents": -700 }
]
```

A positive `netCents` means the member is owed money. A negative value means they owe money. The sum of all `netCents` is always zero.

---

## Join Requests

A separate mechanism from the link-based [Invites](#invites) below: these are targeted
at a specific user (by email, via `POST /api/groups/:id/members` above) and require
explicit acceptance.

### GET `/api/groups/:id/join-requests`

List pending outgoing invites for a group (requires group membership). Used by the
"Ausstehende Einladungen" section in the members panel.

**Response `200`:**

```json
[
  {
    "id": "clx...",
    "invitedName": "Anna",
    "invitedEmail": "anna@even-up.local",
    "createdAt": "2026-06-01T10:00:00.000Z"
  }
]
```

### GET `/api/join-requests`

List the current user's own pending incoming requests, across all groups.

**Response `200`:**

```json
[
  {
    "id": "clx...",
    "groupId": "clx...",
    "groupName": "Ski Trip 2026",
    "invitedByName": "Demo User",
    "createdAt": "2026-06-01T10:00:00.000Z"
  }
]
```

### POST `/api/join-requests/:id/accept`

Accept a pending request. Must be the invited user. If the user already became a
member of the group in the meantime (e.g. via an invite link), this is a no-op success
rather than an error — and no notification email is sent in that case.

If `RESEND_API_KEY` is configured, the original inviter gets an email notifying them
that their invite was accepted, fire-and-forget — same non-blocking behavior as above.

**Response `200`:** `{ "message": "Beigetreten" }`

**Errors:** `403` not the invited user, `404` not found, `409` already responded to

### POST `/api/join-requests/:id/decline`

Decline a pending request. Same ownership rules as accept. No membership is created.

**Response `200`:** `{ "message": "Anfrage abgelehnt" }`

---

## Expenses

All expense endpoints require authentication and group membership.

### GET `/api/groups/:groupId/expenses`

List expenses in the group, ordered by date descending (ties broken by `id` descending for
stable pagination). Supports offset-based pagination.

**Query parameters:**

| Parameter | Type    | Default | Max | Description                         |
| --------- | ------- | ------- | --- | ----------------------------------- |
| `limit`   | integer | `20`    | 100 | Number of items to return per page  |
| `offset`  | integer | `0`     | —   | Number of items to skip (0-indexed) |

**Response `200`:**

```json
{
  "items": [
    {
      "id": "clx...",
      "groupId": "clx...",
      "description": "Abendessen",
      "amountCents": 4568,
      "originalAmountCents": 4800,
      "originalCurrency": "USD",
      "appliedMarkupRate": 1.5,
      "paidByUserId": "clx...",
      "paidByName": "Demo User",
      "date": "2026-01-15",
      "updatedAt": "2026-01-15T12:00:00.000Z",
      "splitMode": "equal",
      "splits": [
        { "userId": "clx...", "owedCents": 1500 },
        { "userId": "clx...", "owedCents": 1500 },
        { "userId": "clx...", "owedCents": 1500 }
      ]
    }
  ],
  "total": 42
}
```

`amountCents` is always in the **group's base currency** (used for balance calculation).
`originalAmountCents` and `originalCurrency` are the values the user entered (equal to `amountCents`/group currency when no conversion was needed).

`total` is the count of all expenses in the group (regardless of `limit`/`offset`), used by
the frontend to show the "X of Y" counter and determine whether to show a "Load more" button.

### GET `/api/groups/:groupId/expenses/:expenseId`

Fetch a single expense by ID. Used by the edit route to load the current expense data.

**Response `200`:** Expense object (same shape as a single item in the list above)

**Errors:** `403` not a member, `404` not found

### POST `/api/groups/:groupId/expenses`

Create an expense. Splits are auto-calculated based on `splitMode` and current member count.

If `currency` differs from the group's base currency, the API fetches the historical exchange rate for the expense date from [Frankfurter v2](https://api.frankfurter.dev) (ECB data) with automatic fallback to [Frankfurter v1](https://api.frankfurter.app/latest) for today's rate when v2 cannot serve it. Rates are cached permanently in the `ExchangeRate` table. Both original and converted amounts are stored.

If `markupRate` is provided (and `currency` differs from the group currency), the converted amount is multiplied by `1 + markupRate/100` before being stored. The markup is applied after conversion so all splits sum to the markup-inclusive total.

**Request body:**

```json
{
  "description": "Abendessen",
  "amountCents": 4800,
  "currency": "USD",
  "markupRate": 1.5,
  "paidByUserId": "clx...",
  "date": "2026-01-15",
  "splitMode": "equal"
}
```

`currency` is optional; defaults to the group's base currency if omitted.
`markupRate` is optional (0–100); defaults to 0 (no markup) if omitted.

**`splitMode` options:** `equal`, `exact`, `percent`, `shares`

**Response `201`:** Expense object (same shape as GET item, includes `appliedMarkupRate`)

**Errors:** `503` exchange rate unavailable (both Frankfurter v2 and v1 unreachable, no cached rate)

### PUT `/api/groups/:groupId/expenses/:expenseId`

Update an existing expense. Deletes old splits and recalculates. Same currency-conversion and markup logic as POST.

**Request body:** Same as POST plus `updatedAt` ISO string (required for optimistic-concurrency check)

**Response `200`:** Updated expense object (includes `appliedMarkupRate`)

**Errors:** `409` concurrent edit (updatedAt mismatch), `503` exchange rate unavailable (both APIs unreachable)

### DELETE `/api/groups/:groupId/expenses/:expenseId`

Delete an expense and its associated splits.

**Response `204`:** No content

---

## Settlements

### GET `/api/groups/:id/settlements`

List all recorded settlements for the group, ordered by date descending.

**Response `200`:** Array of settlement objects (same shape as the POST response below)

### GET `/api/groups/:id/settle-up?simplify=true`

Get suggested transfers to settle all debts. The `simplify` parameter (default `true`) enables the greedy min-cash-flow algorithm to reduce the number of transfers.

**Response `200`:**

```json
[
  { "fromUserId": "clx...", "toUserId": "clx...", "amountCents": 800 },
  { "fromUserId": "clx...", "toUserId": "clx...", "amountCents": 700 }
]
```

### POST `/api/groups/:id/settlements`

Record a payment between two members.

**Request body:**

```json
{
  "fromUserId": "clx...",
  "toUserId": "clx...",
  "amountCents": 800,
  "date": "2026-05-03",
  "note": "Bar bezahlt"
}
```

**Response `201`:**

```json
{
  "id": "clx...",
  "groupId": "clx...",
  "fromUserId": "clx...",
  "toUserId": "clx...",
  "fromUserName": "Anna",
  "toUserName": "Demo User",
  "amountCents": 800,
  "date": "2026-05-03",
  "note": "Bar bezahlt",
  "createdAt": "2026-05-03T12:00:00.000Z"
}
```

### PUT `/api/groups/:id/settlements/:settlementId`

Update an existing settlement (amount, date, note, or the two parties).

**Request body:** Same as POST

**Response `200`:** Updated settlement object

**Errors:** `404` settlement not found in this group

### DELETE `/api/groups/:id/settlements/:settlementId`

Delete a settlement.

**Response `204`:** No content

**Errors:** `404` settlement not found in this group

---

## Invites

### POST `/api/groups/:id/invites`

Generate a shareable invite link. Requires group membership. Token expires after 7 days.

**Response `201`:**

```json
{
  "token": "clx...",
  "expiresAt": "2026-05-10T09:30:00.000Z"
}
```

The frontend constructs the full URL as `{origin}/invite/{token}`.

### POST `/api/invites/:token/accept`

Accept an invite and join the group. Requires authentication (but not group membership).

**Response `201`** (joined):

```json
{ "groupId": "clx...", "groupName": "Ski Trip 2026", "alreadyMember": false }
```

**Response `200`** (already a member):

```json
{ "groupId": "clx...", "groupName": "Ski Trip 2026", "alreadyMember": true }
```

**Errors:** `404` token invalid or expired

---

## Activities

### GET `/api/activities`

List activity events across **all** groups the authenticated user is a member of,
newest first — powers the dashboard's global activity feed. Requires authentication
only (no group membership check needed, since it's scoped to the caller's own
memberships). Supports the same offset-based pagination as the per-group endpoint
below.

**Query parameters:** Same as `/api/groups/:groupId/activities` below.

**Response `200`:**

```json
{
  "items": [
    {
      "id": "clx...",
      "groupId": "clx...",
      "groupName": "Ski Trip 2026",
      "type": "expense_created",
      "actorName": "Demo User",
      "data": { "description": "Abendessen", "amountCents": 4500 },
      "createdAt": "2026-05-24T17:30:00.000Z"
    }
  ],
  "total": 87
}
```

Note the extra `groupName` field (absent from the per-group endpoint below, since there
it's implied by the URL).

### GET `/api/groups/:groupId/activities`

Requires authentication and group membership.

List activity events for the group, ordered newest first. Supports offset-based pagination.

**Query parameters:**

| Parameter | Type    | Default | Max | Description                         |
| --------- | ------- | ------- | --- | ----------------------------------- |
| `limit`   | integer | `20`    | 100 | Number of items to return per page  |
| `offset`  | integer | `0`     | —   | Number of items to skip (0-indexed) |

**Response `200`:**

```json
{
  "items": [
    {
      "id": "clx...",
      "type": "expense_created",
      "actorName": "Demo User",
      "data": { "description": "Abendessen", "amountCents": 4500 },
      "createdAt": "2026-05-24T17:30:00.000Z"
    }
  ],
  "total": 87
}
```

`total` is the total event count for the group. The frontend shows a "X of Y" counter and a
"Load more" button when `total > items shown`.

**Event types:** `expense_created`, `expense_edited`, `expense_deleted`, `settlement_recorded`, `settlement_edited`, `settlement_deleted`, `member_invited`, `member_joined`

---

## Error Format

All errors return a consistent JSON shape:

```json
{ "error": "Human-readable error message" }
```

Validation errors (Zod) include field-level details:

```json
{
  "error": "Ungültige Eingabe",
  "details": {
    "email": ["Invalid email"],
    "password": ["String must contain at least 6 character(s)"]
  }
}
```

| Status | Meaning                                                                          |
| ------ | -------------------------------------------------------------------------------- |
| `400`  | Validation error (Zod)                                                           |
| `401`  | Missing or invalid JWT                                                           |
| `403`  | Not a member of the group                                                        |
| `404`  | Resource not found                                                               |
| `409`  | Duplicate (email already exists, already a member, join request already pending) or concurrent edit conflict |
| `500`  | Internal server error                                                            |
| `503`  | Exchange rate unavailable (Frankfurter API unreachable, no cached rate in DB)    |

# ADR 010: Multi-currency Expense Tracking

## Status

Accepted

## Context

EvenUp previously stored all monetary values in a single implied currency (EUR). Groups
shared among people from different countries — or trips abroad — could not record
expenses in a foreign currency without manually converting amounts. The grading
rubric lists multi-currency support as a stretch goal.

Requirements:
- Per-expense currency selection (user picks from a list; default is the group's base currency)
- Amounts must be stored in a common unit so the existing balance computation stays correct
- Original amount and currency must be preserved so users can see what they actually paid
- Rates must be reliable, reproducible, and not require user action or manual input
- No paid API key or third-party account should be needed

## Decision

### Rate source: Frankfurter API (ECB data) with dual-version fallback

Use the free, open, no-auth-required **Frankfurter** API which serves historical and
current rates from the **European Central Bank**. Two API versions are tried in order:

```
1. GET https://api.frankfurter.dev/v2/{date}?base={from}&symbols={to}   (v2, historical)
2. GET https://api.frankfurter.app/latest?base={from}&symbols={to}      (v1, fallback)
```

Each fetch carries a `AbortSignal.timeout(5000)` to prevent indefinite hangs. The
fallback to v1 is needed because Frankfurter v2 does not support a `/latest` endpoint —
requesting today's date before the ECB publishes rates (typically ~16:00 CET), or
requesting a weekend/holiday date, causes v2 to return a 404. v1's `/latest` always
returns the most recent business-day rate and handles these cases. The `503` error is
only raised when both fetches fail.

Rationale:
- No API key or account needed
- Deterministic historical rates — the rate for a past date never changes, which means
  cached rates are always valid
- ECB is a credible, authoritative source
- Dual-version fallback makes expense creation succeed reliably for today's date

### Permanent DB cache in `ExchangeRate` table

Because historical rates are immutable, every fetched rate is stored with a unique index
on `(date, fromCurrency, toCurrency)` and never expires. Subsequent requests for the
same pair hit the DB instead of the external API. This eliminates latency variability and
makes the app resilient to Frankfurter downtime for rates it has already seen.

A `503` error is returned only when the rate is needed but is not cached *and* the
Frankfurter request fails.

### Dual-amount storage on `Expense`

Two new columns are added to `Expense`:
- `originalAmountCents` — the amount as entered by the user, in `originalCurrency`
- `originalCurrency` — the ISO 4217 code the user selected

The existing `amountCents` column is **redefined** to always hold the amount converted
to the group's base currency (`Group.currency`). All existing balance computation,
settlement, and simplification logic reads only `amountCents` and continues to work
without modification.

For existing rows (before the migration), `originalAmountCents` is backfilled to the
value of `amountCents` and `originalCurrency` to `"EUR"`.

### User and Group currency preferences

- `User.preferredCurrency` defaults to `"EUR"` and can be updated via `PATCH /api/auth/me`
- When a new group is created, its `currency` is set from `creator.preferredCurrency`
- The group currency is shown in the group header and used as the default for new expenses

### Supported currencies

31 currencies covered by the ECB/Frankfurter API:
AUD, BGN, BRL, CAD, CHF, CNY, CZK, DKK, EUR, GBP, HKD, HUF, IDR, ILS, INR, ISK, JPY,
KRW, MXN, MYR, NOK, NZD, PHP, PLN, RON, SEK, SGD, THB, TRY, USD, ZAR.

### Client-side display toggle

The frontend computes a per-currency balance breakdown (`computePerCurrencyBalances`)
in `GroupDetail` from the raw expense and split data. A toggle ("Umgerechnet / Original")
is shown only when a group has expenses in more than one currency. When toggled off,
`BalancesPanel` renders a breakdown per original currency rather than the single
converted total.

This avoids a dedicated API endpoint for per-currency balances and keeps the existing
`GET /balances` response stable.

## Consequences

**Positive:**
- Users can record expenses in any ECB-covered currency; no manual conversion needed
- The existing balance computation is entirely unchanged (reads only `amountCents`)
- Rates are cached after first use — the app never calls Frankfurter twice for the same date/pair
- 31 currencies covers the vast majority of real-world group-expense scenarios
- New `GET /groups/:groupId/expenses/:expenseId` endpoint added as a byproduct — the
  edit route now fetches the individual expense directly rather than paginating through
  the full list

**Negative / trade-offs:**
- Groups that span currencies see `amountCents` / `originalAmountCents` diverge — a
  distinction that must be handled correctly in every future feature that touches expense
  amounts (e.g. CSV export, receipt photo, statistics)
- The `ExchangeRate` table grows unboundedly; no eviction policy is needed (rates are
  immutable), but the table may become large for long-lived deployments with many
  currencies
- The `503` surface is new: if Frankfurter is down and no cached rate exists for a new
  pair, the expense creation fails rather than silently using a wrong rate
- EUR is not available as a conversion target in Frankfurter's standard response because
  ECB quotes all rates relative to EUR; same-currency requests (`from === to`) short-
  circuit to `rate = 1` before any API call, so EUR → EUR works correctly

## Alternatives Considered

**Store amounts only in the original currency, compute conversions at query time:**
Rejected — would require the balance endpoint to call the rate API on every request and
would make balances depend on live rate availability.

**Use a free tier of a paid API (Open Exchange Rates, ExchangeRate-API):**
Rejected — requires account creation and API key management; adds operational burden
without meaningful benefit over Frankfurter.

**Let users enter the converted amount manually:**
Rejected — error-prone and poor UX; users should not have to compute exchange rates.

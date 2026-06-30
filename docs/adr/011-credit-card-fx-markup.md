# ADR 011: Credit Card FX Markup Rate

## Status

Accepted

## Context

When paying abroad with a credit card, banks and card issuers typically charge a foreign
exchange markup on top of the ECB/interbank rate — commonly 1–2 %. If users enter the
ECB rate as the converted amount but their card actually charged a higher rate, the
recorded expense is slightly lower than what they actually paid, and the resulting
settlement is inaccurate.

Users asked for a way to account for this markup so that the amounts in EvenUp reflect
their real card charges rather than the raw ECB rate.

Requirements:
- The markup should be optional — users who pay with no-FX-fee cards should not be forced
  to enter one
- The markup percentage should have a user-level default so it does not need to be
  re-entered on every foreign expense
- The effective rate applied to a specific expense must be recorded so the history is
  reproducible (not affected by later changes to the user's default)
- The markup must integrate cleanly with the existing currency-conversion flow

## Decision

### User-level default: `defaultMarkupRate` on `User`

A `defaultMarkupRate Float @default(0)` column is added to the `User` model. Users can
set this in **Settings → Credit Card FX Markup**. It is persisted via
`PATCH /api/auth/me` and returned by `GET /api/auth/me`.

### Per-expense stored rate: `appliedMarkupRate` on `Expense`

An `appliedMarkupRate Float @default(0)` column is added to the `Expense` model. When
an expense is created or edited with a markup applied, this value is stored alongside the
expense. This means the history is stable — changing the user's default later does not
retroactively alter recorded expenses.

### Markup applied post-conversion

The markup factor is applied **after** currency conversion, not to the original amount:

```
convertedAmountCents = round(originalAmountCents × exchangeRate)
finalAmountCents     = round(convertedAmountCents × (1 + markupRate / 100))
```

Applying it post-conversion matches how card charges actually work (the bank converts
first, then adds the fee to the converted total). Splits are calculated from
`finalAmountCents`, so all parties share the markup proportionally.

### Optional toggle in the expense form

The markup toggle is shown only when the selected expense currency differs from the
group's base currency (no markup makes sense for same-currency expenses). When visible:

- A checkbox/toggle enables or disables the markup for that specific expense
- An editable number input shows the rate (pre-filled from `defaultMarkupRate`)
- The user can override the rate per expense without changing their default

### Loader-data pre-fill pattern

The user's `defaultMarkupRate` is passed to the expense form as **loader data** from the
`clientLoader`, not read from `AuthContext` at render time. This avoids a React state
timing bug: `useState` initialises once on mount, and if `AuthContext` is still loading
when the component mounts, the initial value is locked to `0` regardless of what the
context later resolves to. The loader always awaits `requireAuth()` before the component
renders, so the pre-fill is deterministic.

`requireAuth()` was updated to return the fetched `AuthUser` object (it fetched it
anyway for the auth check) rather than discarding the result.

### `appliedMarkupRate > 0` hint in the expense list

`ExpenseItem` shows a small secondary line `incl. X% card fee` when
`expense.appliedMarkupRate > 0`, making it clear at a glance which expenses include a
markup.

## Consequences

**Positive:**
- Users with FX-fee cards get accurate settlement amounts without manual calculation
- The default rate is set once per user; per-expense overrides are available
- Stored `appliedMarkupRate` makes expense history reproducible and auditable
- The toggle is hidden for same-currency expenses — no UI clutter for domestic groups

**Negative / trade-offs:**
- `appliedMarkupRate` is a new column all expense queries must select; existing
  serialisation (`formatExpense`) must always include it
- The markup is applied to the post-conversion total, not the original amount — this is
  semantically correct but may be surprising to users who think of the markup as a
  percentage of the foreign amount
- If the user's card actually charges a different rate per transaction, the stored
  `defaultMarkupRate` is only an approximation; the per-expense override field mitigates
  this

## Alternatives Considered

**Compute `appliedMarkupRate` from user settings at display time, don't store it:**
Rejected — changing the user's default would retroactively alter all past expense
totals, breaking the audit trail and making it impossible to reproduce a balance
calculation from history alone.

**Apply markup to the original (pre-conversion) amount:**
Rejected — does not match how FX fees are actually charged (the bank converts first and
applies the fee to the converted result). Applying to the original amount would produce a
slightly different final total.

**Show the markup rate input always (not just for foreign currencies):**
Rejected — a markup only makes sense when a currency conversion happens. Showing it for
same-currency expenses would confuse users and allow entering a markup that has no
mathematical effect (since no conversion is performed).

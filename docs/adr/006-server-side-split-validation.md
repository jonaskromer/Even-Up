# ADR 006: Server-side Split Validation and Computation

## Status

Accepted

## Context

Expense splits define how a payment is divided among group members — the core financial
calculation of the app. EvenUp supports four split modes: `equal` (divide evenly),
`exact` (arbitrary amounts per member), `percent` (percentage shares), and `shares`
(ratio-based).

The API's `POST /expenses` and `PUT /expenses/:id` endpoints accepted an `exactSplits`
array from the client: `[{ userId, owedCents }]`. The server stored these values directly
without independent validation.

This meant:

- **For `equal` splits**, the client computed and sent `owedCents`. The server did not
  verify that the amounts were actually equal or summed to the total.
- **For `exact`/`percent`/`shares` splits**, the client performed all computation. The
  server stored whatever `owedCents` values were sent.
- A modified client could submit arbitrary `owedCents` values — e.g., claiming Alice owes
  €0 and Bob owes the full amount, regardless of what the UI showed.
- Non-members could be included in split arrays. Duplicate `userId` entries could appear.
- The sum of `owedCents` might not match `amountCents`, introducing phantom money.

This was explicitly documented as a known issue in the original ausarbeitung and listed as
a high-priority improvement.

## Decision

Introduce `computeAndValidateSplits()` in `apps/api/src/lib/computeSplits.ts`. This
function runs on every `POST` and `PUT` for expenses, before any database write.

**For `equal` split mode:**

The server ignores any client-provided `exactSplits` entirely and recomputes from scratch:
total `amountCents` divided evenly among `participants` (the subset of member IDs included
in the split). Remainder cents are distributed one-by-one to the first participants.

**For `exact`, `percent`, and `shares` split modes:**

The client-computed `exactSplits` are accepted, but validated:

1. Every `userId` in `splits` must be a member of the group — no non-member splits.
2. No duplicate `userId` entries.
3. The sum of `owedCents` must equal `amountCents` within a tolerance of ±`splits.length`
   cents (one cent per participant). This accommodates rounding differences from
   percent/shares arithmetic done client-side.
4. No individual `owedCents` may be negative.

If any check fails, the endpoint returns **422 Unprocessable Entity** with a structured
error message identifying the specific violation.

The Zod schema (`updateExpenseSchema` in `packages/shared`) retains `exactSplits` as the
transmission format — the shared schema is the contract, the server function is the
enforcement.

## Rationale

- **Never trust client-computed financial data.** The server is the source of truth for
  all stored amounts. A split that doesn't match what the server would compute from the
  inputs is an inconsistency — whether from a bug, a manipulated client, or a race
  condition.
- **`equal` is fully server-computed.** Equal splits have no legitimate reason to be
  client-provided: the algorithm is deterministic and the server has all the inputs. Making
  the server authoritative for `equal` eliminates an entire category of potential inconsistency.
- **Tolerance for non-equal modes.** Percent and shares splits involve floating-point
  intermediate values that the client rounds to integer cents. A zero-tolerance check would
  reject valid client submissions due to rounding. The ±1 cent per participant tolerance is
  narrow enough to catch genuine mismatches while accepting correct rounding differences.
- **422 over 400.** The input is syntactically valid Zod-schema-conforming data — the
  failure is semantic (the values don't satisfy the split invariants). 422 Unprocessable
  Entity is the correct HTTP status for this distinction.

## Test Coverage

10 tests in `apps/api/src/tests/computeSplits.test.ts`:

- `equal` mode: server recomputes, remainder distributed correctly
- `equal` with `participants` subset: only listed members get splits
- `exact`/`percent`/`shares`: passes with sum within tolerance
- Non-member in splits → 422
- Duplicate `userId` → 422
- Sum too far from `amountCents` → 422
- Negative `owedCents` → 422
- Edge case: single participant gets full amount

## Consequences

- **`equal` split `exactSplits` from the client are silently replaced.** Clients that sent
  pre-computed equal splits (the original behavior) will have their values overwritten by
  the server's computation. The result is the same for correct clients; incorrect clients
  are corrected silently.
- **Non-equal modes require the client to send reasonable values.** The tolerance check
  means a client that rounds differently than ±1 cent per participant will get a 422. In
  practice, the UI's rounding (integer division with remainder distribution) matches the
  server's tolerance. Future alternative clients must document their rounding strategy.
- **`participants` field added to the Expense schema.** To support subset splits (`equal`
  among a chosen set of members), the server needs to know which members are included. This
  is passed as `participants: string[]` alongside `exactSplits`. For `equal` mode, this is
  the authoritative list; for other modes, it is used only for the non-member check.
- **The `computeAndValidateSplits` function is not shared.** It lives in `apps/api/src/lib/`
  rather than `packages/shared` — the computation depends on group membership data that
  only the server has at request time. The Zod schema in `packages/shared` validates the
  shape; the lib function validates the semantics.

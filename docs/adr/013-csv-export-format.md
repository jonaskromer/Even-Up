# ADR 013: CSV Export Format — Matching Import, Keyed by Email

## Status

Accepted

## Context

CSV expense import already existed (`ImportExpensesButton.tsx`, M5 stretch goal),
parsing a wide, Splitwise-style format: one row per expense (`Date,Description,Cost`),
followed by one column per group member holding that member's **net balance** for the
expense (positive if they're owed money, negative if they owe it). Columns were
matched to group members by a fuzzy, case-insensitive comparison against each
member's display **name**.

When CSV export was added, two design questions came up:

1. **What shape should the exported CSV be?** The first implementation used a
   different, "long" shape — one row per `(expense, split)` pair, with explicit
   `ExpenseId`/`PaidByUserId`/`UserId`/`SplitMode` columns. This is a reasonable
   normalized representation, but it doesn't match what import reads at all, so a
   group's own exported data couldn't be re-imported into another group (or the same
   one, for a backup/restore use case) without a format conversion step.
2. **How should a CSV row identify a member?** The long-format attempt used the
   internal `userId` (a Prisma/Supabase UUID) plus a resolved display name. Import's
   pre-existing name-matching is fragile: two different members can share a first
   name or a full name, and the fuzzy first-name fallback (`matchMember()`) exists
   specifically to route around exactly that ambiguity, imperfectly.

## Decision

Export uses the **same wide, per-member-net-balance CSV shape import already
reads**, and **both import and export identify members by email**, not by internal
id or display name.

- `expenseExportRowSchema` (`packages/shared/src/schemas/expenseExport.ts`) validates
  one logical row: `{ date, description, amountCents, memberNetCents: Record<email,
  number> }`. The CSV's dynamic member columns are a serialization detail handled by
  `rowsToCsv()` in `apps/api/src/routes/expenses.ts`, not part of the schema itself —
  the column set (and order) is simply every current group member's email, sorted.
- For each expense, the payer's net is `amountCents - theirOwedCents`; every other
  member's net is `-theirOwedCents` (0 if they weren't part of that expense's split
  at all). This is exactly Splitwise's own convention, and exactly what
  `ImportExpensesButton.tsx`'s `parseCsv()` already expects on the way in.
- `matchMember()` (import) was changed from fuzzy name matching to an exact,
  case-insensitive email match, so both directions agree.
- `GET /api/groups/:groupId/expenses/export` deliberately excludes
  `ReceiptLineItem`/`ReceiptLineItemAssignment` — a receipt-created expense exports
  identically to a manually-entered one, using only its final `Expense`/
  `ExpenseSplit` rows, matching the split-level (not line-item-level) grain of the
  format.

## Why email over id or name

- **Not the internal id:** a UUID is meaningless in a human-edited spreadsheet and
  leaks an internal implementation detail into an exported artifact with no upside.
- **Not the display name:** two different people can have the same name (the exact
  ambiguity the old fuzzy-matching import code had to guess around). Email is
  guaranteed unique per `User` row and is still a human-recognizable identifier,
  unlike an id.
- Since there is no "remove member" endpoint anywhere in the app, current group
  membership is always a superset of every historical expense's participants — the
  export's member-column set (built from current membership) never has to account
  for a payer or split participant who's no longer a member.

## A rounding-drift correction learned in production

`computeAndValidateSplits()`'s `equal` mode (`apps/api/src/services/computeSplits.ts`)
assigns every member `Math.round(amountCents / memberCount)` with **no remainder
correction**, so on an amount not evenly divisible by the member count, the stored
`ExpenseSplit.owedCents` values can sum to up to `memberCount − 1` cents more or less
than `amountCents`. This drift is accepted and persisted as-is; nothing about `equal`
mode validates or corrects it at creation time.

The schema's first version required a row's `memberNetCents` to sum to *exactly*
zero, which is stricter than the data it validates — any group with a real `equal`
split on a non-evenly-divisible amount (a common, unremarkable case) failed export
entirely with a generic `400 Ungültige Eingabe`, discovered only after a user hit it
against their real group data. The fix relaxes the `superRefine` check to the same
`±1 cent per member` tolerance `computeAndValidateSplits` already allows, instead of
an exact zero — a schema should never be stricter than the invariants the system
producing its data actually guarantees. A regression test creates exactly this
scenario (a 3-way `equal` split of an amount not divisible by 3) and asserts export
succeeds.

## Consequences

- A group's expense data now round-trips: export, then re-import into the same or a
  different group, reconstructs equivalent expenses (subject to import's own
  member-matching and its exact/percent/shares reconstruction from net values).
- The export is one-way for anything beyond `Expense`/`ExpenseSplit` — receipt line
  items, settlements, and activity history are not part of either format.
- If two members ever shared an email (not possible — `User.email` is unique), or a
  member's email changed between export and a later import, column matching would
  silently drop that member's data on import; this mirrors a pre-existing limitation
  of the format, not a new one introduced by switching from name to email.

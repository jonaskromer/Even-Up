# ADR 002: Greedy Min-Cash-Flow for Debt Simplification

## Status

Accepted

## Context

When a group has multiple expenses and many members, the naive settlement approach produces one transfer per debtor-creditor pair. For _n_ members this can yield up to _n(n−1)/2_ transfers. Users want a "simplify debts" option that reduces the number of transfers while preserving each person's net balance.

Three algorithms were considered:

1. **Greedy min-cash-flow** — Sort debtors and creditors by amount, match largest debtor with largest creditor, transfer the minimum of the two, repeat. Runs in O(n log n) time.
2. **Linear programming** — Model as a min-cost flow problem. Optimal but complex to implement and overkill for typical group sizes (3–10 members).
3. **NP-hard minimum-transfers** — Finding the true minimum number of transfers is NP-hard (reducible to subset-sum). Not practical for real-time computation.

## Decision

Use the **greedy min-cash-flow algorithm**.

## Rationale

- **Correctness.** The algorithm guarantees that every member's net balance is preserved exactly. The sum of all net balances is zero by construction, so the algorithm always terminates.
- **Near-optimal for small groups.** For groups of 2–10 members (the typical case), greedy produces at most _n−1_ transfers, which is optimal or within one transfer of optimal.
- **Simplicity.** The entire implementation is ~35 lines in `debtSimplificationService.ts`. No external dependencies.
- **Performance.** O(n log n) for the sort, O(n) for the matching loop. Negligible for any realistic group size.

## Algorithm

```
Input:  balances[] — each member's net cents (positive = owed money, negative = owes money)
Output: transfers[] — { from, to, amount }

1. Partition into debtors (netCents < 0) and creditors (netCents > 0)
2. Sort both lists by amount descending
3. While debtors and creditors remain:
   a. amount = min(debtor.amount, creditor.amount)
   b. Emit transfer(debtor → creditor, amount)
   c. Subtract amount from both; drop zeroed entries
```

## Example

Three members after expenses:

| Member | Net Balance |
| ------ | ----------- |
| Alice  | +30,00 €    |
| Bob    | −20,00 €    |
| Carol  | −10,00 €    |

**Without simplification:** Bob → Alice 20 €, Carol → Alice 10 € (2 transfers)
**With simplification:** Same result — 2 transfers (already optimal for 3 members)

For 5+ members the savings become more significant, as the greedy approach merges multiple small debts into fewer larger transfers.

## Consequences

- The settle-up API (`GET /api/groups/:id/settle-up?simplify=true`) returns the simplified transfer list by default.
- The frontend `SettleUpPanel` offers a toggle to switch between simplified and unsimplified suggestions.
- The algorithm does not guarantee the theoretical minimum number of transfers (which is NP-hard), but produces results that are practical and easy to understand.

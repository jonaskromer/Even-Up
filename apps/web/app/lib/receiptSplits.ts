import type { ReceiptDraftLineItem } from '../types';

// Splits a single line item's priceCents across its assignees according to its own
// splitMode (equal/exact/percent/shares) — mirrors apps/api/src/routes/receipts.ts's
// computeSingleItemSplit exactly (including the "remainder to last assignee" rounding
// convention) so the UI's live totals match what the server will actually persist.
export function computeSingleItemSplit(
  item: ReceiptDraftLineItem,
): { userId: string; owedCents: number }[] {
  const n = item.assignments.length;
  if (n === 0) return [];

  if (item.splitMode === 'exact') {
    return item.assignments.map((a) => ({ userId: a.userId, owedCents: a.exactCents ?? 0 }));
  }

  if (item.splitMode === 'percent') {
    let allocated = 0;
    return item.assignments.map((a, i) => {
      const isLast = i === n - 1;
      const owedCents = isLast
        ? item.priceCents - allocated
        : Math.round((item.priceCents * (a.percent ?? 0)) / 100);
      allocated += owedCents;
      return { userId: a.userId, owedCents };
    });
  }

  if (item.splitMode === 'equal') {
    const base = Math.floor(item.priceCents / n);
    const remainder = item.priceCents - base * n;
    return item.assignments.map((a, i) => ({
      userId: a.userId,
      owedCents: base + (i === n - 1 ? remainder : 0),
    }));
  }

  // 'shares'
  const totalWeight = item.assignments.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight === 0) return [];
  let allocated = 0;
  return item.assignments.map((a, i) => {
    const isLast = i === n - 1;
    const owedCents = isLast
      ? item.priceCents - allocated
      : Math.round((item.priceCents * a.weight) / totalWeight);
    allocated += owedCents;
    return { userId: a.userId, owedCents };
  });
}

// Aggregates every non-excluded line item's per-assignee split into one
// exactSplits-shaped array per user across all line items.
export function computeReceiptSplits(
  lineItems: ReceiptDraftLineItem[],
): { userId: string; owedCents: number }[] {
  const totals = new Map<string, number>();

  for (const item of lineItems) {
    if (item.excluded) continue;
    for (const s of computeSingleItemSplit(item)) {
      totals.set(s.userId, (totals.get(s.userId) ?? 0) + s.owedCents);
    }
  }

  return Array.from(totals.entries()).map(([userId, owedCents]) => ({ userId, owedCents }));
}

export function receiptTotalCents(lineItems: ReceiptDraftLineItem[]): number {
  return lineItems.filter((li) => !li.excluded).reduce((sum, li) => sum + li.priceCents, 0);
}

// Per-item validity check for the "exact"/"percent" modes — used to disable Continue
// until every item's numbers actually add up (same tolerance the server enforces).
export function isItemSplitValid(item: ReceiptDraftLineItem): boolean {
  if (item.excluded) return true;
  const n = item.assignments.length;
  if (n === 0) return false;

  if (item.splitMode === 'exact') {
    const sum = item.assignments.reduce((s, a) => s + (a.exactCents ?? 0), 0);
    return Math.abs(sum - item.priceCents) <= n;
  }
  if (item.splitMode === 'percent') {
    const totalPct = item.assignments.reduce((s, a) => s + (a.percent ?? 0), 0);
    return Math.abs(totalPct - 100) <= 0.5;
  }
  if (item.splitMode === 'shares') {
    return item.assignments.reduce((s, a) => s + a.weight, 0) > 0;
  }
  return true; // 'equal'
}

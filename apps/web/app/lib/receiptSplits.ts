import type { ReceiptDraftLineItem } from '../types';

// Splits each non-excluded line item's priceCents across its assignees proportional to
// weight (rounding drift patched onto the last assignee), then aggregates the result
// per user across all line items. Mirrors the backend's computeLineItemSplits exactly
// (apps/api/src/routes/receipts.ts) so the displayed totals match what gets submitted.
export function computeReceiptSplits(
  lineItems: ReceiptDraftLineItem[],
): { userId: string; owedCents: number }[] {
  const totals = new Map<string, number>();

  for (const item of lineItems) {
    if (item.excluded) continue;
    const totalWeight = item.assignments.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight === 0) continue;

    let allocated = 0;
    item.assignments.forEach((a, i) => {
      const isLast = i === item.assignments.length - 1;
      const share = isLast
        ? item.priceCents - allocated
        : Math.round((item.priceCents * a.weight) / totalWeight);
      allocated += share;
      totals.set(a.userId, (totals.get(a.userId) ?? 0) + share);
    });
  }

  return Array.from(totals.entries()).map(([userId, owedCents]) => ({ userId, owedCents }));
}

export function receiptTotalCents(lineItems: ReceiptDraftLineItem[]): number {
  return lineItems.filter((li) => !li.excluded).reduce((sum, li) => sum + li.priceCents, 0);
}

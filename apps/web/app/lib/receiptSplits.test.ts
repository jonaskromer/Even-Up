import { describe, it, expect } from 'vitest';
import {
  computeReceiptSplits,
  computeSingleItemSplit,
  isItemSplitValid,
  receiptTotalCents,
} from './receiptSplits';
import type { ReceiptDraftLineItem } from '../types';

function item(overrides: Partial<ReceiptDraftLineItem>): ReceiptDraftLineItem {
  return {
    name: 'Item',
    quantity: 1,
    priceCents: 1000,
    excluded: false,
    splitMode: 'shares',
    assignments: [],
    ...overrides,
  };
}

describe('computeSingleItemSplit', () => {
  it('splits equally, remainder on the last assignee', () => {
    const result = computeSingleItemSplit(
      item({
        splitMode: 'equal',
        priceCents: 301,
        assignments: [
          { userId: 'a', weight: 1 },
          { userId: 'b', weight: 1 },
        ],
      }),
    );
    expect(result).toEqual([
      { userId: 'a', owedCents: 150 },
      { userId: 'b', owedCents: 151 },
    ]);
  });

  it('splits by shares proportionally', () => {
    const result = computeSingleItemSplit(
      item({
        splitMode: 'shares',
        priceCents: 900,
        assignments: [
          { userId: 'a', weight: 1 },
          { userId: 'b', weight: 2 },
        ],
      }),
    );
    expect(result).toEqual([
      { userId: 'a', owedCents: 300 },
      { userId: 'b', owedCents: 600 },
    ]);
  });

  it('uses exact amounts directly', () => {
    const result = computeSingleItemSplit(
      item({
        splitMode: 'exact',
        priceCents: 1000,
        assignments: [
          { userId: 'a', weight: 1, exactCents: 700 },
          { userId: 'b', weight: 1, exactCents: 300 },
        ],
      }),
    );
    expect(result).toEqual([
      { userId: 'a', owedCents: 700 },
      { userId: 'b', owedCents: 300 },
    ]);
  });

  it('splits by percentage, remainder on the last assignee', () => {
    const result = computeSingleItemSplit(
      item({
        splitMode: 'percent',
        priceCents: 1000,
        assignments: [
          { userId: 'a', weight: 1, percent: 33 },
          { userId: 'b', weight: 1, percent: 67 },
        ],
      }),
    );
    const sum = result.reduce((s, r) => s + r.owedCents, 0);
    expect(sum).toBe(1000);
    expect(result.find((r) => r.userId === 'a')?.owedCents).toBe(330);
  });

  it('returns an empty array when there are no assignees', () => {
    expect(computeSingleItemSplit(item({ assignments: [] }))).toEqual([]);
  });
});

describe('computeReceiptSplits', () => {
  it('aggregates across multiple line items and skips excluded ones', () => {
    const result = computeReceiptSplits([
      item({
        priceCents: 500,
        splitMode: 'equal',
        assignments: [
          { userId: 'a', weight: 1 },
          { userId: 'b', weight: 1 },
        ],
      }),
      item({
        priceCents: 999,
        excluded: true,
        assignments: [{ userId: 'a', weight: 1 }],
      }),
      item({
        priceCents: 300,
        splitMode: 'exact',
        assignments: [{ userId: 'a', weight: 1, exactCents: 300 }],
      }),
    ]);

    expect(result.find((r) => r.userId === 'a')?.owedCents).toBe(250 + 300);
    expect(result.find((r) => r.userId === 'b')?.owedCents).toBe(250);
  });
});

describe('receiptTotalCents', () => {
  it('sums only non-excluded items', () => {
    const total = receiptTotalCents([
      item({ priceCents: 500 }),
      item({ priceCents: 999, excluded: true }),
      item({ priceCents: 300 }),
    ]);
    expect(total).toBe(800);
  });
});

describe('isItemSplitValid', () => {
  it('is valid for equal mode with at least one assignee', () => {
    expect(
      isItemSplitValid(item({ splitMode: 'equal', assignments: [{ userId: 'a', weight: 1 }] })),
    ).toBe(true);
  });

  it('is invalid for exact mode when amounts do not sum to the price', () => {
    const valid = isItemSplitValid(
      item({
        splitMode: 'exact',
        priceCents: 1000,
        assignments: [{ userId: 'a', weight: 1, exactCents: 500 }],
      }),
    );
    expect(valid).toBe(false);
  });

  it('is valid for exact mode when amounts sum to the price', () => {
    const valid = isItemSplitValid(
      item({
        splitMode: 'exact',
        priceCents: 1000,
        assignments: [{ userId: 'a', weight: 1, exactCents: 1000 }],
      }),
    );
    expect(valid).toBe(true);
  });

  it('is invalid for percent mode when percentages do not sum to 100', () => {
    const valid = isItemSplitValid(
      item({
        splitMode: 'percent',
        assignments: [{ userId: 'a', weight: 1, percent: 50 }],
      }),
    );
    expect(valid).toBe(false);
  });

  it('is always valid when the item is excluded', () => {
    expect(isItemSplitValid(item({ excluded: true, assignments: [] }))).toBe(true);
  });

  it('is invalid when a non-excluded item has no assignees', () => {
    expect(isItemSplitValid(item({ assignments: [] }))).toBe(false);
  });
});

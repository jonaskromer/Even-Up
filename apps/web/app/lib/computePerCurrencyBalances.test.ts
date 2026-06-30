import { describe, it, expect } from 'vitest';
import { computePerCurrencyBalances } from './computePerCurrencyBalances';
import type { Expense } from '../types';

const memberIds = ['u1', 'u2'];
const memberMap = { u1: 'Alice', u2: 'Bob' };

function makeExpense(overrides: Partial<Expense>): Expense {
  return {
    id: 'e1',
    groupId: 'g1',
    description: 'Test',
    amountCents: 1000,
    originalAmountCents: 1000,
    originalCurrency: 'EUR',
    appliedMarkupRate: 0,
    paidByUserId: 'u1',
    paidByName: 'Alice',
    date: '2026-01-01',
    splitMode: 'equal',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computePerCurrencyBalances', () => {
  it('returns empty array for no expenses', () => {
    const result = computePerCurrencyBalances([], memberIds, memberMap);
    expect(result).toEqual([]);
  });

  it('single currency — one bucket, net sums to zero', () => {
    const expense = makeExpense({
      amountCents: 2000,
      originalAmountCents: 2000,
      originalCurrency: 'EUR',
      splits: [
        { userId: 'u1', owedCents: 1000 },
        { userId: 'u2', owedCents: 1000 },
      ],
    });
    const result = computePerCurrencyBalances([expense], memberIds, memberMap);
    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe('EUR');
    const total = result[0].balances.reduce((s, b) => s + b.netCents, 0);
    expect(total).toBe(0);
  });

  it('payer gets credited in original currency', () => {
    const expense = makeExpense({
      amountCents: 1000,
      originalAmountCents: 900,
      originalCurrency: 'USD',
      splits: [
        { userId: 'u1', owedCents: 500 },
        { userId: 'u2', owedCents: 500 },
      ],
    });
    const result = computePerCurrencyBalances([expense], memberIds, memberMap);
    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe('USD');
    const payerBal = result[0].balances.find((b) => b.userId === 'u1')!;
    // Alice paid 900 USD original and owes 450 USD → net = 900 - 450 = +450
    expect(payerBal.netCents).toBeGreaterThan(0);
  });

  it('proportional split: 50/50 on USD expense', () => {
    const expense = makeExpense({
      amountCents: 1000,
      originalAmountCents: 900,
      originalCurrency: 'USD',
      splits: [
        { userId: 'u1', owedCents: 500 },
        { userId: 'u2', owedCents: 500 },
      ],
    });
    const result = computePerCurrencyBalances([expense], memberIds, memberMap);
    const bucket = result[0];
    const aliceBal = bucket.balances.find((b) => b.userId === 'u1')!;
    const bobBal = bucket.balances.find((b) => b.userId === 'u2')!;

    // ratio = 500/1000 = 0.5, originalOwed = round(0.5 * 900) = 450
    // Alice: +900 - 450 = +450
    // Bob: 0 - 450 = -450
    expect(aliceBal.netCents).toBe(450);
    expect(bobBal.netCents).toBe(-450);
    expect(aliceBal.netCents + bobBal.netCents).toBe(0);
  });

  it('two currencies produce two separate buckets', () => {
    const eurExpense = makeExpense({
      id: 'e-eur',
      amountCents: 2000,
      originalAmountCents: 2000,
      originalCurrency: 'EUR',
      splits: [
        { userId: 'u1', owedCents: 1000 },
        { userId: 'u2', owedCents: 1000 },
      ],
    });
    const usdExpense = makeExpense({
      id: 'e-usd',
      amountCents: 1100,
      originalAmountCents: 1000,
      originalCurrency: 'USD',
      paidByUserId: 'u2',
      splits: [
        { userId: 'u1', owedCents: 550 },
        { userId: 'u2', owedCents: 550 },
      ],
    });
    const result = computePerCurrencyBalances([eurExpense, usdExpense], memberIds, memberMap);
    expect(result).toHaveLength(2);

    const currencies = result.map((r) => r.currency).sort();
    expect(currencies).toEqual(['EUR', 'USD']);

    for (const bucket of result) {
      const total = bucket.balances.reduce((s, b) => s + b.netCents, 0);
      expect(total).toBe(0);
    }
  });

  it('member names are populated from memberMap', () => {
    const expense = makeExpense({
      splits: [
        { userId: 'u1', owedCents: 500 },
        { userId: 'u2', owedCents: 500 },
      ],
    });
    const result = computePerCurrencyBalances([expense], memberIds, memberMap);
    const names = result[0].balances.map((b) => b.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  it('expenses without splits are not debited (splits undefined)', () => {
    // No splits: payer gets credit, nobody gets debited
    const expense = makeExpense({
      amountCents: 1000,
      originalAmountCents: 1000,
      originalCurrency: 'EUR',
      splits: undefined,
    });
    const result = computePerCurrencyBalances([expense], memberIds, memberMap);
    const payerBal = result[0].balances.find((b) => b.userId === 'u1')!;
    const otherBal = result[0].balances.find((b) => b.userId === 'u2')!;
    expect(payerBal.netCents).toBe(1000);
    expect(otherBal.netCents).toBe(0);
  });
});

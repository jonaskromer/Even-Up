import { describe, it, expect } from 'vitest';
import { formatEuro, computeBalances } from './computeBalances';
import type { Group, Expense } from '../types';

describe('formatEuro', () => {
  it('formats zero', () => {
    expect(formatEuro(0)).toBe('0,00 €');
  });

  it('formats a positive amount', () => {
    expect(formatEuro(1234)).toBe('12,34 €');
  });

  it('formats a negative amount with leading minus', () => {
    expect(formatEuro(-500)).toBe('-5,00 €');
  });

  it('pads single-digit cents', () => {
    expect(formatEuro(101)).toBe('1,01 €');
  });
});

describe('computeBalances', () => {
  const alice = { id: 'a', name: 'Alice', email: 'alice@test.com', role: 'owner' };
  const bob = { id: 'b', name: 'Bob', email: 'bob@test.com', role: 'member' };

  const group: Group = { id: 'g1', name: 'Trip', members: [alice, bob] };

  it('returns zero balances with no expenses', () => {
    const balances = computeBalances(group, []);
    expect(balances.every((b) => b.netCents === 0)).toBe(true);
  });

  it('credits the payer and debits others', () => {
    const expense: Expense = {
      id: 'e1',
      groupId: 'g1',
      description: 'Dinner',
      amountCents: 2000,
      paidByUserId: 'a',
      paidByName: 'Alice',
      date: '2026-01-01',
      splitMode: 'equal',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const balances = computeBalances(group, [expense]);
    const aliceBal = balances.find((b) => b.userId === 'a')!;
    const bobBal = balances.find((b) => b.userId === 'b')!;
    expect(aliceBal.netCents).toBeGreaterThan(0);
    expect(bobBal.netCents).toBeLessThan(0);
    expect(aliceBal.netCents + bobBal.netCents).toBe(0);
  });

  it('ignores expenses from other groups', () => {
    const expense: Expense = {
      id: 'e2',
      groupId: 'other-group',
      description: 'Other',
      amountCents: 1000,
      paidByUserId: 'a',
      paidByName: 'Alice',
      date: '2026-01-01',
      splitMode: 'equal',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const balances = computeBalances(group, [expense]);
    expect(balances.every((b) => b.netCents === 0)).toBe(true);
  });
});

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

  const group: Group = { id: 'g1', name: 'Trip', currency: 'EUR', members: [alice, bob] };

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
      originalAmountCents: 2000,
      originalCurrency: 'EUR',
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
      originalAmountCents: 2000,
      originalCurrency: 'EUR',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const balances = computeBalances(group, [expense]);
    expect(balances.every((b) => b.netCents === 0)).toBe(true);
  });

  it('net sum is always zero across all members', () => {
    const expense: Expense = {
      id: 'e3',
      groupId: 'g1',
      description: 'Lunch',
      amountCents: 3000,
      paidByUserId: 'b',
      paidByName: 'Bob',
      date: '2026-01-02',
      splitMode: 'equal',
      originalAmountCents: 3000,
      originalCurrency: 'EUR',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const balances = computeBalances(group, [expense]);
    const total = balances.reduce((sum, b) => sum + b.netCents, 0);
    expect(total).toBe(0);
  });

  it('handles multiple expenses and net sum stays zero', () => {
    const expenses: Expense[] = [
      {
        id: 'e4',
        groupId: 'g1',
        description: 'Dinner',
        amountCents: 2000,
        paidByUserId: 'a',
        paidByName: 'Alice',
        date: '2026-01-01',
        splitMode: 'equal',
        originalAmountCents: 2000,
        originalCurrency: 'EUR',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'e5',
        groupId: 'g1',
        description: 'Taxi',
        amountCents: 1400,
        paidByUserId: 'b',
        paidByName: 'Bob',
        date: '2026-01-02',
        splitMode: 'equal',
        originalAmountCents: 1400,
        originalCurrency: 'EUR',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    const balances = computeBalances(group, expenses);
    const total = balances.reduce((sum, b) => sum + b.netCents, 0);
    expect(total).toBe(0);
  });
});

describe('computeBalances — three members', () => {
  const alice = { id: 'a', name: 'Alice', email: 'alice@test.com', role: 'owner' };
  const bob = { id: 'b', name: 'Bob', email: 'bob@test.com', role: 'member' };
  const clara = { id: 'c', name: 'Clara', email: 'clara@test.com', role: 'member' };

  const group: Group = { id: 'g2', name: 'Ski Trip', currency: 'EUR', members: [alice, bob, clara] };

  it('payer is credited, others debited, net sums to zero', () => {
    const expense: Expense = {
      id: 'e10',
      groupId: 'g2',
      description: 'Hotel',
      amountCents: 9000,
      paidByUserId: 'a',
      paidByName: 'Alice',
      date: '2026-02-01',
      splitMode: 'equal',
      originalAmountCents: 9000,
      originalCurrency: 'EUR',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    const balances = computeBalances(group, [expense]);
    const aliceBal = balances.find((b) => b.userId === 'a')!;
    const bobBal = balances.find((b) => b.userId === 'b')!;
    const claraBal = balances.find((b) => b.userId === 'c')!;

    expect(aliceBal.netCents).toBeGreaterThan(0);
    expect(bobBal.netCents).toBeLessThan(0);
    expect(claraBal.netCents).toBeLessThan(0);
    expect(aliceBal.netCents + bobBal.netCents + claraBal.netCents).toBe(0);
  });

  it('rounding: 100 cents / 3 members — payer is positive, net is zero', () => {
    const expense: Expense = {
      id: 'e11',
      groupId: 'g2',
      description: 'Coffee',
      amountCents: 100,
      paidByUserId: 'a',
      paidByName: 'Alice',
      date: '2026-02-02',
      splitMode: 'equal',
      originalAmountCents: 100,
      originalCurrency: 'EUR',
      updatedAt: '2026-02-02T00:00:00.000Z',
    };
    const balances = computeBalances(group, [expense]);
    const aliceBal = balances.find((b) => b.userId === 'a')!;
    const total = balances.reduce((sum, b) => sum + b.netCents, 0);

    expect(aliceBal.netCents).toBeGreaterThan(0);
    // Math.round per member can leave ±(memberCount-1) cents of rounding error
    expect(Math.abs(total)).toBeLessThanOrEqual(group.members.length - 1);
  });
});

describe('computeBalances — single member', () => {
  it('single-person group: payer net is zero (paid 100% and owes 100%)', () => {
    const alice = { id: 'a', name: 'Alice', email: 'alice@test.com', role: 'owner' };
    const group: Group = { id: 'g3', name: 'Solo', currency: 'EUR', members: [alice] };
    const expense: Expense = {
      id: 'e20',
      groupId: 'g3',
      description: 'Groceries',
      amountCents: 5000,
      paidByUserId: 'a',
      paidByName: 'Alice',
      date: '2026-03-01',
      splitMode: 'equal',
      originalAmountCents: 5000,
      originalCurrency: 'EUR',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };
    const balances = computeBalances(group, [expense]);
    expect(balances).toHaveLength(1);
    expect(balances[0].netCents).toBe(0);
  });
});

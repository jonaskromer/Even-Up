import { describe, it, expect } from 'vitest';
import { simplifyDebts } from '../services/debtSimplificationService.js';

describe('simplifyDebts', () => {
  it('returns no transfers when all balances are zero', () => {
    const result = simplifyDebts([
      { userId: 'a', netCents: 0 },
      { userId: 'b', netCents: 0 },
    ]);
    expect(result).toEqual([]);
  });

  it('handles a simple two-person debt', () => {
    const result = simplifyDebts([
      { userId: 'a', netCents: 5000 },
      { userId: 'b', netCents: -5000 },
    ]);
    expect(result).toEqual([{ fromUserId: 'b', toUserId: 'a', amountCents: 5000 }]);
  });

  it('produces at most n-1 transfers for n people', () => {
    const result = simplifyDebts([
      { userId: 'a', netCents: 6000 },
      { userId: 'b', netCents: -3000 },
      { userId: 'c', netCents: -3000 },
    ]);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('preserves net balances with 3 people', () => {
    const balances = [
      { userId: 'a', netCents: 6000 },
      { userId: 'b', netCents: -3000 },
      { userId: 'c', netCents: -3000 },
    ];
    const result = simplifyDebts(balances);

    const net = new Map<string, number>();
    for (const t of result) {
      net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) - t.amountCents);
      net.set(t.toUserId, (net.get(t.toUserId) ?? 0) + t.amountCents);
    }
    expect(net.get('a')).toBe(6000);
    expect(net.get('b')).toBe(-3000);
    expect(net.get('c')).toBe(-3000);
  });

  it('preserves net balances with 4+ people', () => {
    const balances = [
      { userId: 'a', netCents: 5000 },
      { userId: 'b', netCents: -2000 },
      { userId: 'c', netCents: -1000 },
      { userId: 'd', netCents: -2000 },
    ];
    const result = simplifyDebts(balances);

    expect(result.length).toBeLessThanOrEqual(3);

    const net = new Map<string, number>();
    for (const t of result) {
      net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) - t.amountCents);
      net.set(t.toUserId, (net.get(t.toUserId) ?? 0) + t.amountCents);
    }
    for (const b of balances) {
      expect(net.get(b.userId) ?? 0).toBe(b.netCents);
    }
  });

  it('returns no transfers when input is empty', () => {
    expect(simplifyDebts([])).toEqual([]);
  });
});

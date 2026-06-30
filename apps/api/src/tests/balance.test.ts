import { describe, it, expect } from 'vitest';

interface Balance {
  userId: string;
  name: string;
  netCents: number;
}

interface Member {
  id: string;
  name: string;
}
interface Expense {
  groupId: string;
  amountCents: number;
  paidByUserId: string;
  splits: { userId: string; owedCents: number }[];
}

function computeBalancesFromExpenses(members: Member[], expenses: Expense[]): Balance[] {
  const net = new Map<string, number>();
  members.forEach((m) => net.set(m.id, 0));

  for (const exp of expenses) {
    net.set(exp.paidByUserId, (net.get(exp.paidByUserId) ?? 0) + exp.amountCents);
    for (const split of exp.splits) {
      net.set(split.userId, (net.get(split.userId) ?? 0) - split.owedCents);
    }
  }

  return members.map((m) => ({
    userId: m.id,
    name: m.name,
    netCents: net.get(m.id) ?? 0,
  }));
}

describe('computeBalances', () => {
  const members: Member[] = [
    { id: 'u1', name: 'Alice' },
    { id: 'u2', name: 'Bob' },
    { id: 'u3', name: 'Clara' },
  ];

  it('net balances sum to zero', () => {
    const expenses: Expense[] = [
      {
        groupId: 'g1',
        amountCents: 9000,
        paidByUserId: 'u1',
        splits: [
          { userId: 'u1', owedCents: 3000 },
          { userId: 'u2', owedCents: 3000 },
          { userId: 'u3', owedCents: 3000 },
        ],
      },
      {
        groupId: 'g1',
        amountCents: 6000,
        paidByUserId: 'u2',
        splits: [
          { userId: 'u1', owedCents: 2000 },
          { userId: 'u2', owedCents: 2000 },
          { userId: 'u3', owedCents: 2000 },
        ],
      },
    ];

    const balances = computeBalancesFromExpenses(members, expenses);
    const total = balances.reduce((sum, b) => sum + b.netCents, 0);
    expect(total).toBe(0);
  });

  it('payer gets credited, others get debited', () => {
    const expenses: Expense[] = [
      {
        groupId: 'g1',
        amountCents: 9000,
        paidByUserId: 'u1',
        splits: [
          { userId: 'u1', owedCents: 3000 },
          { userId: 'u2', owedCents: 3000 },
          { userId: 'u3', owedCents: 3000 },
        ],
      },
    ];

    const balances = computeBalancesFromExpenses(members, expenses);
    expect(balances.find((b) => b.userId === 'u1')?.netCents).toBe(6000);
    expect(balances.find((b) => b.userId === 'u2')?.netCents).toBe(-3000);
    expect(balances.find((b) => b.userId === 'u3')?.netCents).toBe(-3000);
  });

  it('handles rounding with uneven splits', () => {
    const share = Math.round(1000 / 3);
    const expenses: Expense[] = [
      {
        groupId: 'g1',
        amountCents: 1000,
        paidByUserId: 'u1',
        splits: [
          { userId: 'u1', owedCents: share },
          { userId: 'u2', owedCents: share },
          { userId: 'u3', owedCents: share },
        ],
      },
    ];

    const balances = computeBalancesFromExpenses(members, expenses);
    const alice = balances.find((b) => b.userId === 'u1')!;
    expect(alice.netCents).toBe(1000 - share);
  });
});

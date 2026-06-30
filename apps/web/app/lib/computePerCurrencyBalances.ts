import { Balance, Expense } from '../types';

export interface PerCurrencyBalance {
  currency: string;
  balances: Balance[];
}

export function computePerCurrencyBalances(
  expenses: Expense[],
  memberIds: string[],
  memberMap: Record<string, string>,
): PerCurrencyBalance[] {
  const byCurrency = new Map<string, Map<string, number>>();

  for (const exp of expenses) {
    const cur = exp.originalCurrency;
    if (!byCurrency.has(cur)) {
      const net = new Map<string, number>();
      memberIds.forEach((id) => net.set(id, 0));
      byCurrency.set(cur, net);
    }
    const net = byCurrency.get(cur)!;

    net.set(exp.paidByUserId, (net.get(exp.paidByUserId) ?? 0) + exp.originalAmountCents);

    if (exp.splits && exp.amountCents > 0) {
      for (const split of exp.splits) {
        const ratio = split.owedCents / exp.amountCents;
        const originalOwed = Math.round(ratio * exp.originalAmountCents);
        net.set(split.userId, (net.get(split.userId) ?? 0) - originalOwed);
      }
    }
  }

  return Array.from(byCurrency.entries()).map(([currency, net]) => ({
    currency,
    balances: memberIds.map((id) => ({
      userId: id,
      name: memberMap[id] ?? id,
      netCents: net.get(id) ?? 0,
    })),
  }));
}

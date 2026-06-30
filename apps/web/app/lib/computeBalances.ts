import { Balance, Expense, Group } from '../types';

export function computeBalances(group: Group, expenses: Expense[]): Balance[] {
  const net = new Map<string, number>();
  group.members.forEach((m) => net.set(m.id, 0));

  const relevant = expenses.filter((e) => e.groupId === group.id);
  for (const exp of relevant) {
    const share = Math.round(exp.amountCents / group.members.length);
    group.members.forEach((m) => {
      net.set(m.id, (net.get(m.id) ?? 0) - share);
    });
    net.set(exp.paidByUserId, (net.get(exp.paidByUserId) ?? 0) + exp.amountCents);
  }

  return group.members.map((m) => ({
    userId: m.id,
    name: m.name,
    email: m.email,
    netCents: net.get(m.id) ?? 0,
  }));
}

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = (abs % 100).toString().padStart(2, '0');
  return `${sign}${euros},${rest} €`;
}

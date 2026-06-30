import { prisma } from '../db/prisma.js';

export interface Balance {
  userId: string;
  name: string;
  netCents: number;
}

export async function computeBalances(groupId: string): Promise<Balance[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    include: { user: { select: { id: true, name: true } } },
  });

  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: { splits: true },
  });

  const settlements = await prisma.settlement.findMany({
    where: { groupId },
  });

  const net = new Map<string, number>();
  members.forEach((m) => net.set(m.userId, 0));

  for (const exp of expenses) {
    net.set(exp.paidByUserId, (net.get(exp.paidByUserId) ?? 0) + exp.amountCents);
    for (const split of exp.splits) {
      net.set(split.userId, (net.get(split.userId) ?? 0) - split.owedCents);
    }
  }

  for (const s of settlements) {
    net.set(s.fromUserId, (net.get(s.fromUserId) ?? 0) + s.amountCents);
    net.set(s.toUserId, (net.get(s.toUserId) ?? 0) - s.amountCents);
  }

  return members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    netCents: net.get(m.userId) ?? 0,
  }));
}

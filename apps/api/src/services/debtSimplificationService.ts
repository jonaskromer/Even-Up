export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export function simplifyDebts(balances: { userId: string; netCents: number }[]): Transfer[] {
  const debtors: { userId: string; amount: number }[] = [];
  const creditors: { userId: string; amount: number }[] = [];

  for (const b of balances) {
    if (b.netCents < 0) debtors.push({ userId: b.userId, amount: -b.netCents });
    else if (b.netCents > 0) creditors.push({ userId: b.userId, amount: b.netCents });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(debtors[di].amount, creditors[ci].amount);
    transfers.push({
      fromUserId: debtors[di].userId,
      toUserId: creditors[ci].userId,
      amountCents: amount,
    });
    debtors[di].amount -= amount;
    creditors[ci].amount -= amount;
    if (debtors[di].amount === 0) di++;
    if (creditors[ci].amount === 0) ci++;
  }

  return transfers;
}

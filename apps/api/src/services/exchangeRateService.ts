import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/HttpError.js';

export async function getRate(date: string, from: string, to: string): Promise<number> {
  if (from === to) return 1;

  const cached = await prisma.exchangeRate.findUnique({
    where: { date_fromCurrency_toCurrency: { date, fromCurrency: from, toCurrency: to } },
  });
  if (cached) return cached.rate;

  let rate: number;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v2/${date}?base=${from}&symbols=${to}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, number> };
    rate = json.rates[to];
    if (typeof rate !== 'number') throw new Error('Rate missing in response');
  } catch (err) {
    throw new HttpError(
      503,
      `Wechselkurs für ${from}→${to} am ${date} konnte nicht abgerufen werden.`,
    );
  }

  await prisma.exchangeRate.upsert({
    where: { date_fromCurrency_toCurrency: { date, fromCurrency: from, toCurrency: to } },
    create: { date, fromCurrency: from, toCurrency: to, rate },
    update: { rate },
  });

  return rate;
}

import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/HttpError.js';

export async function getRate(date: string, from: string, to: string): Promise<number> {
  if (from === to) return 1;

  const cached = await prisma.exchangeRate.findUnique({
    where: { date_fromCurrency_toCurrency: { date, fromCurrency: from, toCurrency: to } },
  });
  if (cached) return cached.rate;

  async function fetchFromUrl(url: string): Promise<number> {
    const signal = AbortSignal.timeout(5000);
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, number> };
    const r = json.rates[to];
    if (typeof r !== 'number') throw new Error('Rate missing in response');
    return r;
  }

  let rate: number;
  try {
    try {
      // v2 API for historical dates
      rate = await fetchFromUrl(
        `https://api.frankfurter.dev/v2/${date}?base=${from}&symbols=${to}`,
      );
    } catch {
      // v2 doesn't support "latest" — use v1 which does (covers today before ECB publishes)
      rate = await fetchFromUrl(`https://api.frankfurter.app/latest?base=${from}&symbols=${to}`);
    }
  } catch {
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

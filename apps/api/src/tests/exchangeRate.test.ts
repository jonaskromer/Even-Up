import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../db/prisma.js';
import { getRate } from '../services/exchangeRateService.js';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    exchangeRate: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as {
  exchangeRate: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getRate', () => {
  it('returns 1 when from === to', async () => {
    const rate = await getRate('2026-03-20', 'EUR', 'EUR');
    expect(rate).toBe(1);
    expect(mockPrisma.exchangeRate.findUnique).not.toHaveBeenCalled();
  });

  it('returns cached rate when DB has it', async () => {
    mockPrisma.exchangeRate.findUnique.mockResolvedValueOnce({
      rate: 0.9123,
    });

    const rate = await getRate('2026-03-20', 'USD', 'EUR');
    expect(rate).toBe(0.9123);
    expect(mockPrisma.exchangeRate.findUnique).toHaveBeenCalledOnce();
  });

  it('fetches from Frankfurter and caches when DB miss', async () => {
    mockPrisma.exchangeRate.findUnique.mockResolvedValueOnce(null);
    mockPrisma.exchangeRate.upsert.mockResolvedValueOnce({ rate: 0.926 });

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rates: { EUR: 0.926 } }),
    } as Response);

    const rate = await getRate('2026-03-20', 'USD', 'EUR');
    expect(rate).toBe(0.926);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v2/2026-03-20?base=USD&symbols=EUR',
    );
    expect(mockPrisma.exchangeRate.upsert).toHaveBeenCalledOnce();
  });

  it('throws 503 when Frankfurter returns non-ok', async () => {
    mockPrisma.exchangeRate.findUnique.mockResolvedValueOnce(null);
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    await expect(getRate('2026-03-20', 'USD', 'EUR')).rejects.toMatchObject({ status: 503 });
  });
});

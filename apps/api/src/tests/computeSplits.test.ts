import { describe, it, expect } from 'vitest';
import { computeAndValidateSplits } from '../services/computeSplits.js';
import { HttpError } from '../lib/HttpError.js';

const MEMBERS = ['u1', 'u2', 'u3'];

describe('computeAndValidateSplits — equal mode', () => {
  it('recomputes splits server-side and ignores any client exactSplits', () => {
    const result = computeAndValidateSplits('equal', 300, undefined, MEMBERS);
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.owedCents === 100)).toBe(true);
  });

  it('ignores client-supplied exactSplits for equal mode', () => {
    const manipulated = [{ userId: 'u1', owedCents: 300 }];
    const result = computeAndValidateSplits('equal', 300, manipulated, MEMBERS);
    // Must return server-computed equal splits, not the manipulated ones
    expect(result).toHaveLength(3);
    expect(result.find((s) => s.userId === 'u1')!.owedCents).toBe(100);
  });
});

describe('computeAndValidateSplits — exact / percent / shares', () => {
  it('accepts valid splits that sum exactly to amountCents', () => {
    const splits = [
      { userId: 'u1', owedCents: 150 },
      { userId: 'u2', owedCents: 100 },
      { userId: 'u3', owedCents: 50 },
    ];
    expect(() => computeAndValidateSplits('exact', 300, splits, MEMBERS)).not.toThrow();
  });

  it('accepts splits within rounding tolerance (±memberCount cents)', () => {
    // 100 / 3 = 33.33… → Math.round gives 33+33+33 = 99, off by 1
    const splits = [
      { userId: 'u1', owedCents: 33 },
      { userId: 'u2', owedCents: 33 },
      { userId: 'u3', owedCents: 33 },
    ];
    expect(() => computeAndValidateSplits('percent', 100, splits, MEMBERS)).not.toThrow();
  });

  it('rejects missing exactSplits for non-equal mode', () => {
    expect(() => computeAndValidateSplits('exact', 300, undefined, MEMBERS)).toThrow(HttpError);
  });

  it('rejects empty exactSplits for non-equal mode', () => {
    expect(() => computeAndValidateSplits('shares', 300, [], MEMBERS)).toThrow(HttpError);
  });

  it('rejects splits with a userId that is not a group member', () => {
    const splits = [
      { userId: 'u1', owedCents: 150 },
      { userId: 'outsider', owedCents: 150 },
    ];
    expect(() => computeAndValidateSplits('exact', 300, splits, MEMBERS)).toThrow(HttpError);
  });

  it('rejects duplicate userIds', () => {
    const splits = [
      { userId: 'u1', owedCents: 150 },
      { userId: 'u1', owedCents: 150 },
    ];
    expect(() => computeAndValidateSplits('exact', 300, splits, MEMBERS)).toThrow(HttpError);
  });

  it('rejects splits whose sum exceeds tolerance', () => {
    // Sum = 500, amount = 300, tolerance = 3 → delta 200 >> 3
    const splits = [
      { userId: 'u1', owedCents: 200 },
      { userId: 'u2', owedCents: 200 },
      { userId: 'u3', owedCents: 100 },
    ];
    expect(() => computeAndValidateSplits('exact', 300, splits, MEMBERS)).toThrow(HttpError);
  });

  it('rejects splits whose sum is too low', () => {
    const splits = [
      { userId: 'u1', owedCents: 10 },
      { userId: 'u2', owedCents: 10 },
    ];
    expect(() => computeAndValidateSplits('exact', 300, splits, MEMBERS)).toThrow(HttpError);
  });
});

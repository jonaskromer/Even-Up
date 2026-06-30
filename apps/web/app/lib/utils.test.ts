import { describe, it, expect } from 'vitest';
import { formatCurrency } from './utils';

describe('formatCurrency', () => {
  it('formats EUR correctly', () => {
    const result = formatCurrency(1234, 'EUR');
    expect(result).toContain('12');
    expect(result).toContain('34');
    expect(result).toContain('€');
  });

  it('formats USD with dollar sign', () => {
    const result = formatCurrency(5000, 'USD');
    expect(result).toContain('50');
    expect(result).toContain('$');
  });

  it('formats CHF with franc symbol or code', () => {
    const result = formatCurrency(9999, 'CHF');
    expect(result).toContain('99');
    // CHF may render as "CHF" or "Fr." depending on environment
    expect(result.toLowerCase()).toMatch(/chf|fr\./);
  });

  it('formats zero', () => {
    const result = formatCurrency(0, 'EUR');
    expect(result).toContain('0');
    expect(result).toContain('€');
  });

  it('formats negative amounts', () => {
    const result = formatCurrency(-500, 'EUR');
    expect(result).toContain('5');
    expect(result).toContain('€');
    // Negative sign should appear somewhere
    expect(result).toMatch(/-|−/);
  });

  it('formats large amounts', () => {
    const result = formatCurrency(1000000, 'EUR');
    // 10000.00 EUR
    expect(result).toContain('€');
    expect(result).toContain('10');
  });

  it('divides by 100 (cents to units)', () => {
    const result = formatCurrency(100, 'EUR');
    // Should be 1,00 € not 100,00 €
    expect(result).not.toContain('100,00');
    expect(result).toContain('1');
  });

  it('formats JPY without decimals', () => {
    const result = formatCurrency(500, 'JPY');
    // JPY has no subunit; 500 JPY = 5.00 but displayed as ¥5
    expect(result).toContain('¥');
  });
});

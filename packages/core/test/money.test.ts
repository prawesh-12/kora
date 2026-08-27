import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.js';
import { add, compare, format, money } from '../src/money.js';

describe('money', () => {
  it('rejects a non-integer amount', () => {
    expect(() => money(1.5, 'INR')).toThrow(ValidationError);
  });

  it('rejects NaN', () => {
    expect(() => money(Number.NaN, 'INR')).toThrow(ValidationError);
  });

  it('rejects a bad currency code', () => {
    expect(() => money(100, 'rupee')).toThrow(ValidationError);
  });

  it('adds within one currency', () => {
    expect(add(money(100, 'INR'), money(250, 'INR'))).toEqual({
      amountMinor: 350,
      currency: 'INR',
    });
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'INR'), money(100, 'USD'))).toThrow(ValidationError);
  });

  it('orders correctly', () => {
    expect(compare(money(100, 'INR'), money(250, 'INR'))).toBe(-1);
    expect(compare(money(250, 'INR'), money(100, 'INR'))).toBe(1);
    expect(compare(money(100, 'INR'), money(100, 'INR'))).toBe(0);
  });

  it('formats INR', () => {
    expect(format(money(349900, 'INR'))).toContain('3,499');
  });
});

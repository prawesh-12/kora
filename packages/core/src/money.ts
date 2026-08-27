import { ValidationError } from './errors.js';

export interface Money {
  amountMinor: number;
  currency: string;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new ValidationError(`amountMinor must be an integer, got ${amountMinor}`, {
      code: 'INVALID_MONEY',
      context: { amountMinor, currency },
    });
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError(`currency must be a 3 letter code, got ${currency}`, {
      code: 'INVALID_CURRENCY',
      context: { currency },
    });
  }
  return { amountMinor, currency };
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new ValidationError(`cannot mix ${a.currency} and ${b.currency}`, {
      code: 'CURRENCY_MISMATCH',
      context: { a, b },
    });
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function compare(a: Money, b: Money): number {
  sameCurrency(a, b);
  return a.amountMinor === b.amountMinor ? 0 : a.amountMinor < b.amountMinor ? -1 : 1;
}

export function format(m: Money, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(
    m.amountMinor / 100,
  );
}

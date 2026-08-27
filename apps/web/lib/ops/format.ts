export const NO_DATA = 'no data';

/** The one em dash used for an empty cell. Anywhere a value is unknown, use this. */
export const EMPTY = '—';

/** `0ms` is a claim that something took no time. An unknown duration says so instead. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return EMPTY;
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** `null` is not zero. A rate over no eligible runs is unknown, and says so. */
export function formatRate(rate: number | null): string {
  return rate === null ? NO_DATA : `${(rate * 100).toFixed(1)}%`;
}

/**
 * A single run costs far less than a cent, so dollars to four places renders
 * every row as `$0.0001` and the column stops carrying information.
 *
 * Micro-dollars are the unit the number is stored in and the unit that
 * distinguishes one run from another, so that is the unit shown. Anything at or
 * above a cent gets dollars, because by then dollars are readable again.
 */
export function formatCostMicros(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return EMPTY;
  if (micros === 0) return '0';
  if (micros < 10_000) return `${Math.round(micros)}µ$`;
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/** Aggregate spend, where dollars are the readable unit. */
export function formatUsd(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return NO_DATA;
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) return `<$0.01`;
  return `$${dollars.toFixed(2)}`;
}

export function formatMoneyMinor(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null) return EMPTY;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency ?? 'INR',
  }).format(amountMinor / 100);
}

export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

/** Relative in tables, absolute on hover. Both come from the same instant. */
export function formatRelative(at: Date | string | null | undefined): string {
  if (!at) return EMPTY;
  return formatElapsed(Date.now() - new Date(at).getTime());
}

export function formatAbsolute(at: Date | string | null | undefined): string {
  if (!at) return '';
  return new Date(at).toLocaleString();
}

/** Ids are mono and truncated. The full value belongs in a title and a copy button. */
export function truncateId(id: string | null | undefined, length = 8): string {
  if (!id) return EMPTY;
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}

/**
 * `OUT_OF_SCOPE` is an identifier, not a sentence. It stays uppercase mono only
 * in the failure-code column, where it is the thing being named; everywhere
 * else it reads as prose.
 */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return EMPTY;
  return value.toLowerCase().replace(/_/g, ' ');
}

export const NO_DATA = 'no data';

export const EMPTY = '—';

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return EMPTY;
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? NO_DATA : `${(rate * 100).toFixed(1)}%`;
}

/**
 * A single run costs far less than a cent, so dollars would render every row as
 * `$0.0001`. Micro-dollars are the stored unit and the one that tells runs apart.
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

export function formatRelative(at: Date | string | null | undefined): string {
  if (!at) return EMPTY;
  return formatElapsed(Date.now() - new Date(at).getTime());
}

export function formatAbsolute(at: Date | string | null | undefined): string {
  if (!at) return '';
  return new Date(at).toLocaleString();
}

export function truncateId(id: string | null | undefined, length = 8): string {
  if (!id) return EMPTY;
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}

export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return EMPTY;
  return value.toLowerCase().replace(/_/g, ' ');
}

/**
 * Failure details arrive as whatever the trace had closest to a cause, including
 * raw engine output like the policy engine's `insufficient facts: exceedsRefundable,`.
 */
export function humanizeFailureDetail(detail: string): string {
  if (detail.startsWith('insufficient facts:')) return 'missing billing facts';
  if (detail.startsWith('no rule matched')) return 'no rule matched';
  if (/^[A-Z][A-Z0-9_]*$/.test(detail)) return humanizeEnum(detail);
  return detail;
}

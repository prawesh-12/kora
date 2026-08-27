export const NO_DATA = 'no data';

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** `null` is not zero. A rate over no eligible runs is unknown, and says so. */
export function formatRate(rate: number | null): string {
  return rate === null ? NO_DATA : `${(rate * 100).toFixed(1)}%`;
}

export function formatUsdMicros(micros: number | null): string {
  return micros === null ? NO_DATA : `$${(micros / 1_000_000).toFixed(4)}`;
}

export function formatMoneyMinor(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null) return '—';
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

import Link from 'next/link';
import type { FailureBucketDto } from '@/lib/api/schemas';

/**
 * Drawn as linked bars rather than a Recharts `BarChart` because every bar has to
 * be a real navigation to the filtered conversation list. That drill is the reason
 * the breakdown exists, and an SVG rect is not a link.
 */
export function FailureChart({
  buckets,
  from,
  to,
}: {
  buckets: FailureBucketDto[];
  from: string;
  to: string;
}) {
  if (buckets.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No classified failures in this window. Runs still waiting on evaluation are counted as
        pending, not as failures.
      </p>
    );
  }

  const widest = Math.max(...buckets.map((b) => b.count));

  return (
    <ul className="flex flex-col gap-1.5" data-testid="failure-chart">
      {buckets.map((bucket) => (
        <li key={bucket.code}>
          <Link
            href={`/ops/conversations?failureCode=${bucket.code}&from=${from}&to=${to}`}
            data-testid="failure-bar"
            data-code={bucket.code}
            className="group block rounded-md border bg-card px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium font-mono text-sm">{bucket.code}</span>
              <span className="shrink-0 font-semibold tabular-nums">{bucket.count}</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-destructive/70 transition-[width]"
                style={{ width: `${Math.max((bucket.count / widest) * 100, 4)}%` }}
              />
            </div>
            <p className="pt-1.5 text-muted-foreground text-xs">
              most common: <span className="font-mono">{bucket.topDetail}</span>
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

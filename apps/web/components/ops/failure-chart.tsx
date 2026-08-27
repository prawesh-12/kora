import { FAILURE_SEVERITY, type FailureCode } from '@kora/core';
import { BarChart } from '@/components/charts/chart';
import type { FailureBucketDto } from '@/lib/api/schemas';

/**
 * A server component on purpose. `@kora/core` re-exports `secrets.ts`, which
 * imports `node:crypto`, so anything in the browser that reaches into core
 * fails the client build. The severity table is read here and the plain data
 * goes to the client chart.
 *
 * Severity picks the colour, count picks the length.
 *
 * These rows are links to the filtered conversation list, which is the reason
 * the breakdown exists at all. That drill path is why the bars are markup and
 * not an SVG chart: a rect is not a link, and a count of 2 has to stay clickable
 * next to a count of 622.
 */
export function FailureChart({ buckets, days }: { buckets: FailureBucketDto[]; days: number }) {
  const data = buckets.map((bucket) => ({
    label: bucket.code,
    value: bucket.count,
    severity: FAILURE_SEVERITY[bucket.code as FailureCode] ?? 'normal',
    detail: bucket.topDetail,
    href: `/ops/conversations?failureCode=${bucket.code}&days=${days}`,
  }));

  return (
    <div data-testid="failure-chart">
      <BarChart
        data={data}
        emptyMessage="No classified failures in this window. Runs still waiting on evaluation are counted as pending, not as failures."
      />
    </div>
  );
}

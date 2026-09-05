import { FAILURE_SEVERITY, type FailureCode } from '@kora/core';
import { BarChart } from '@/components/charts/chart';
import { humanizeFailureDetail } from '@/lib/ops/format';
import type { FailureBucketDto } from '@/lib/api/schemas';

/**
 * A server component on purpose: `@kora/core` re-exports `secrets.ts`, which
 * imports `node:crypto`, so reading the severity table in the browser fails the
 * client build. The bars are markup rather than an SVG chart because each row
 * has to be a link into the filtered conversation list.
 */
export function FailureChart({ buckets, days }: { buckets: FailureBucketDto[]; days: number }) {
  const data = buckets.map((bucket) => ({
    label: bucket.code,
    value: bucket.count,
    severity: FAILURE_SEVERITY[bucket.code as FailureCode] ?? 'normal',
    detail: humanizeFailureDetail(bucket.topDetail),
    detailTitle: bucket.topDetail,
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

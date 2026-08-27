'use client';

import { LineChart } from '@/components/charts/chart';
import type { VrrPointDto } from '@/lib/api/schemas';

export function VrrTrend({ points }: { points: VrrPointDto[] }) {
  const data = points
    .filter((p) => p.rate !== null)
    .map((p) => ({ day: p.day, rate: Number(((p.rate ?? 0) * 100).toFixed(1)) }));

  return (
    <LineChart
      data={data}
      x="day"
      y="rate"
      yFormat={(n) => `${n}%`}
      height={240}
      ariaLabel="Verified resolution rate by day"
      emptyMessage="No evaluated runs in this window, so there is no trend to draw."
    />
  );
}

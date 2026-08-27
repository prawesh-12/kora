'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { VrrPointDto } from '@/lib/api/schemas';

const config = {
  rate: { label: 'Verified resolution rate', color: 'var(--chart-1)' },
} satisfies ChartConfig;

export function VrrTrend({ points }: { points: VrrPointDto[] }) {
  const data = points
    .filter((p) => p.rate !== null)
    .map((p) => ({ day: p.day, rate: Number(((p.rate ?? 0) * 100).toFixed(1)), n: p.evaluated }));

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No evaluated runs in this window, so there is no trend to draw.
      </p>
    );
  }

  return (
    <ChartContainer config={config} className="h-[240px] w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={40}
          tickFormatter={(v) => `${v}%`}
        />
        <ChartTooltip content={<ChartTooltipContent labelKey="day" />} />
        <Line
          dataKey="rate"
          type="monotone"
          stroke="var(--color-rate)"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

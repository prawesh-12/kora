'use client';

import { defineChart, lineY } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * The only file allowed to import `@tanstack/charts`, which is pre-alpha and can
 * change its API between minor releases. `pnpm lint` fails on imports elsewhere.
 */

export type LinePoint = Record<string, string | number | null>;

export interface LineChartProps {
  data: LinePoint[];
  x: string;
  y: string;
  yFormat?: (n: number) => string;
  height?: number;
  emptyMessage: string;
  ariaLabel: string;
  className?: string;
}

export function LineChart({
  data,
  x,
  y,
  yFormat = (n) => String(n),
  height = 240,
  emptyMessage,
  ariaLabel,
  className,
}: LineChartProps) {
  const id = useId();

  const definition = useMemo(() => {
    if (data.length < 2) return null;

    // Narrowed rather than cast: the library infers channel types from the datum,
    // and an index signature gives it nothing to infer from.
    const points = data.map((row) => ({
      label: String(row[x] ?? ''),
      value: Number(row[y] ?? 0),
    }));

    return defineChart({
      marks: [lineY(points, { x: 'label', y: 'value' })],
      scales: {
        x: { scale: () => scalePoint<string>().padding(0.4) },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { ticks: { count: 4, format: (value: number) => yFormat(value) } },
        },
      },
    });
  }, [data, x, y, yFormat]);

  if (data.length === 0) {
    return <ChartNotice height={height} className={className} message={emptyMessage} />;
  }

  if (data.length === 1) {
    const only = data[0] as Record<string, unknown>;
    return (
      <div
        className={cn('flex flex-col justify-center gap-1 rounded-lg border p-5', className)}
        style={{ minHeight: height }}
      >
        <span className="font-semibold text-3xl tabular-nums">{yFormat(Number(only[y] ?? 0))}</span>
        <span className="text-muted-foreground text-sm">
          {String(only[x] ?? '')} · a trend line appears once there are two days of runs
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <Chart definition={definition!} height={height} ariaLabel={ariaLabel} idPrefix={id} />
    </div>
  );
}

export type BarSeverity = 'critical' | 'normal' | 'low';

export interface BarDatum {
  label: string;
  value: number;
  severity: BarSeverity;
  detail?: string;
  /** The raw value behind a humanized detail, for the title attribute. */
  detailTitle?: string;
  /** A string rather than a callback: these bars are rendered from a server
   *  component, which cannot pass a function across the client boundary. */
  href?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  valueFormat?: (n: number) => string;
  /** Client components only. Use `href` on the datum from a server component. */
  onSelect?: (label: string) => void;
  emptyMessage: string;
  className?: string;
}

/** Severity picks the colour, count picks the length: a rare failure must not
 *  also be the faintest one on screen. */
const SEVERITY_BAR: Record<BarSeverity, string> = {
  critical: 'bg-destructive',
  normal: 'bg-warning',
  low: 'bg-muted-foreground/40',
};

const MIN_BAR_PERCENT = 4;

export function BarChart({
  data,
  valueFormat = (n) => n.toLocaleString(),
  onSelect,
  emptyMessage,
  className,
}: BarChartProps) {
  if (data.length === 0) {
    return <ChartNotice height={160} className={className} message={emptyMessage} />;
  }

  const largest = Math.max(...data.map((d) => d.value), 1);

  return (
    <ul className={cn('flex flex-col', className)}>
      {data.map((datum) => {
        // A floor, so a count of 2 beside a count of 622 is still clickable.
        const percent = Math.max(MIN_BAR_PERCENT, (datum.value / largest) * 100);

        const row = (
          <div className="flex w-full items-center gap-3 py-2 text-left">
            <span className="w-12 shrink-0 text-right font-medium text-sm tabular-nums">
              {valueFormat(datum.value)}
            </span>
            <span className="w-52 shrink-0 truncate font-mono text-xs" title={datum.label}>
              {datum.label}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn('block h-full rounded-full', SEVERITY_BAR[datum.severity])}
                style={{ width: `${percent}%` }}
              />
            </span>
            {datum.detail ? (
              <span
                className="hidden w-56 shrink-0 truncate text-muted-foreground text-xs md:block"
                title={datum.detailTitle ?? datum.detail}
              >
                {datum.detail}
              </span>
            ) : null}
          </div>
        );

        const interactive =
          'block w-full rounded-md px-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

        return (
          <li key={datum.label} className="border-b last:border-0">
            {datum.href ? (
              <a
                className={interactive}
                data-code={datum.label}
                data-testid="failure-bar"
                href={datum.href}
              >
                {row}
              </a>
            ) : onSelect ? (
              <button className={interactive} onClick={() => onSelect(datum.label)} type="button">
                {row}
              </button>
            ) : (
              <div className="px-2">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChartNotice({
  message,
  height,
  className,
}: {
  message: string;
  height: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg border border-dashed p-5 text-center text-muted-foreground text-sm',
        className,
      )}
      style={{ minHeight: height }}
    >
      {message}
    </div>
  );
}

import { Children, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatTone = 'default' | 'ok' | 'warn' | 'danger' | 'info';

const TONE_CLASS: Record<StatTone, string> = {
  default: 'text-foreground',
  ok: 'text-success',
  warn: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
};

const LABEL = 'font-medium text-muted-foreground text-xs uppercase tracking-[0.06em]';

export interface TileProps {
  label: string;
  value: string;
  /** The denominator, the sample size, or whatever else qualifies the number. */
  sub?: string;
  tone?: StatTone;
}

/**
 * A label with a number is a tile, not a card. Nine numbers in nine bordered
 * cards is most of a screen of padding; the same nine as one strip is a third of
 * the height and never leaves an orphan on the last row.
 */
export function Tile({ label, value, sub, tone = 'default' }: TileProps) {
  return (
    <div className="flex h-[76px] flex-col justify-center gap-0.5 bg-background px-5 py-4">
      <span className={LABEL}>{label}</span>
      <span className={cn('font-semibold text-2xl tabular-nums', TONE_CLASS[tone])}>{value}</span>
      {sub ? <span className="truncate text-muted-foreground text-xs">{sub}</span> : null}
    </div>
  );
}

/**
 * The tile count must divide evenly into the column count. A last row holding
 * one tile beside two empty columns is a broken layout, so the fix is always to
 * change the column count, never to leave the gap.
 */
export function StatBar({ columns, children }: { columns: 3 | 4; children: ReactNode }) {
  if (process.env.NODE_ENV !== 'production') {
    const count = Children.count(children);
    if (count % columns !== 0) {
      throw new Error(
        `StatBar: ${count} tiles across ${columns} columns leaves a partial row. Change the column count or move a metric into the hero.`,
      );
    }
  }

  return (
    <div className="overflow-hidden rounded-[10px] border">
      <div
        className={cn(
          'grid gap-px bg-border sm:grid-cols-2',
          columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One per page: the number the page exists to produce. Context sits on the same
 * line as the value rather than under it, so the strip stays one band tall.
 */
export function HeroStat({
  label,
  value,
  tone = 'default',
  context,
  aside,
}: {
  label: string;
  value: string;
  tone?: StatTone;
  /** The denominator. A rate without one is not a number anyone should act on. */
  context?: string;
  /** Trend, or the reason there is no trend to draw. */
  aside?: ReactNode;
}) {
  return (
    <div className="flex h-[112px] flex-col justify-center gap-1 rounded-[10px] border px-5 py-4">
      <span className={LABEL}>{label}</span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className={cn('font-semibold text-4xl tabular-nums', TONE_CLASS[tone])}>{value}</span>
        {context ? <span className="text-muted-foreground text-sm">{context}</span> : null}
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
    </div>
  );
}

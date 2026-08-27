import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StatTone = 'default' | 'ok' | 'warn' | 'danger' | 'info';

const TONE_CLASS: Record<StatTone, string> = {
  default: 'text-foreground',
  ok: 'text-success',
  warn: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
};

export interface StatProps {
  label: string;
  value: string;
  /** The denominator, the sample size, or whatever qualifies the number. */
  hint?: string;
  tone?: StatTone;
  /**
   * One per page. The number the page exists to produce, at 3xl across two
   * columns. When every card has the same weight, the number that matters looks
   * exactly like latency.
   */
  hero?: boolean;
  children?: ReactNode;
}

export function Stat({ label, value, hint, tone = 'default', hero, children }: StatProps) {
  return (
    <Card className={cn(hero && 'sm:col-span-2')} size="sm">
      <CardContent className="flex h-full flex-col justify-center gap-1 p-5">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {label}
        </span>
        <span
          className={cn(
            'font-semibold tabular-nums',
            hero ? 'text-3xl' : 'text-xl',
            TONE_CLASS[tone],
          )}
        >
          {value}
        </span>
        {hint ? <span className="text-muted-foreground text-sm">{hint}</span> : null}
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Three columns, not four. Nine cards fill three rows exactly and six fill two;
 * four columns leave an orphan on the last row at both counts.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

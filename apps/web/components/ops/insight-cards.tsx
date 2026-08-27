import type { ReactElement } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface InsightCardItem {
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
}

const TONE_CLASS = {
  default: 'text-foreground',
  positive: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
} as const;

export function InsightCards({ items }: { items: InsightCardItem[] }): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.id} size="sm">
          <CardContent className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {item.label}
            </span>
            <span
              className={cn(
                'text-2xl leading-tight font-semibold tabular-nums',
                TONE_CLASS[item.tone ?? 'default'],
              )}
            >
              {item.value}
            </span>
            {item.hint !== undefined && (
              <span className="font-mono text-xs text-muted-foreground">{item.hint}</span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

'use client';

import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

export interface TaskRowItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  amount?: string;
  selected?: boolean;
  urgent?: boolean;
}

export function TaskRows({
  items,
  onSelect,
  emptyLabel = 'Nothing waiting for approval',
}: {
  items: TaskRowItem[];
  onSelect?: (id: string) => void;
  emptyLabel?: string;
}): ReactElement {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            aria-current={item.selected === true}
            onClick={() => onSelect?.(item.id)}
            className={cn(
              'flex w-full items-center gap-4 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
              'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              item.selected === true && 'border-primary bg-muted',
              item.urgent === true && 'border-destructive/60',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {item.title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {item.amount !== undefined && (
                <span className="text-base leading-none font-semibold tabular-nums text-foreground">
                  {item.amount}
                </span>
              )}
              <span
                className={cn(
                  'text-xs text-muted-foreground',
                  item.urgent === true && 'font-medium text-destructive',
                )}
              >
                {item.meta}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

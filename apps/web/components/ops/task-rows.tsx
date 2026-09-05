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
              item.urgent === true && 'approval-urgent-pulse border-warning/60',
            )}
          >
            {item.amount === undefined ? null : (
              <span className="tnum w-28 shrink-0 font-mono font-semibold text-foreground text-lg">
                {item.amount}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground text-sm">
                {item.title}
              </span>
              <span className="block truncate text-muted-foreground text-xs">{item.subtitle}</span>
            </span>
            <span
              className={cn(
                'shrink-0 text-muted-foreground text-xs',
                item.urgent === true && 'font-medium text-warning-strong',
              )}
            >
              {item.meta}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

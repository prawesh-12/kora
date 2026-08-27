'use client';

import { ChevronDown, FileText } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ContextCardItem {
  id: string;
  title: string;
  headingPath: string;
  documentVersion: number;
  distance: number;
  content: string;
}

function ContextCard({ item }: { item: ContextCardItem }): ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-card-foreground">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
        <Badge variant="outline" className="shrink-0 tabular-nums">
          v{item.documentVersion}
        </Badge>
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="w-full px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {item.headingPath}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {item.distance.toFixed(3)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-180',
            )}
          />
        </span>
        <span
          className={cn(
            'mt-1.5 block text-sm leading-relaxed text-muted-foreground',
            !expanded && 'line-clamp-3',
          )}
        >
          {item.content}
        </span>
      </button>
    </div>
  );
}

export function ContextCards({ items }: { items: ContextCardItem[] }): ReactElement {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No chunks retrieved</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <ContextCard key={item.id} item={item} />
      ))}
    </div>
  );
}

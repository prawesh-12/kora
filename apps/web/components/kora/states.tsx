import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Built on shadcn's `empty` primitive; ReUI's equivalents need a licence. */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    // `flex-none` overrides the primitive's `flex-1`, which would stretch the
    // empty state to the height of the populated component.
    <Empty className={cn('flex-none border py-8', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? (
        <EmptyContent>
          <Button asChild size="sm" variant="outline">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="w-full">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, row) => (
        <div
          className="flex h-10 items-center gap-4 border-b px-2 last:border-0"
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no identity
          key={row}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              className={cn('h-3', column === 0 ? 'w-24' : 'w-16')}
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cells have no identity
              key={column}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  title = 'That did not load',
  description,
  traceId,
  retry,
  className,
}: {
  title?: string;
  description: string;
  traceId?: string | null;
  retry?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center',
        className,
      )}
      role="alert"
    >
      <p className="font-medium text-sm">{title}</p>
      <p className="max-w-md text-muted-foreground text-sm">{description}</p>
      {traceId ? (
        <p className="font-mono text-muted-foreground text-xs" title={traceId}>
          trace {traceId}
        </p>
      ) : null}
      {retry}
    </div>
  );
}

import { cn } from '@/lib/utils';

const ENTRIES = [
  { dot: 'bg-success', label: 'verified' },
  { dot: 'bg-warning', label: 'waiting' },
  { dot: 'bg-destructive', label: 'denied or failed' },
  { dot: 'bg-muted-foreground', label: 'missing data' },
] as const;

export function StateLegend({ className }: { className?: string }) {
  return (
    <dl className={cn('flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs', className)}>
      {ENTRIES.map((entry) => (
        <div className="flex items-center gap-1.5" key={entry.label}>
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', entry.dot)} />
          <dt className="sr-only">state</dt>
          <dd>{entry.label}</dd>
        </div>
      ))}
    </dl>
  );
}

'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { truncateId } from '@/lib/ops/format';
import { cn } from '@/lib/utils';

export function CopyId({ id, className }: { id: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className={cn(
        'tnum inline-flex items-center gap-1.5 rounded font-mono text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      title={id}
      type="button"
    >
      {truncateId(id)}
      {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
      <span className="sr-only">{copied ? 'Copied' : `Copy ${id}`}</span>
    </button>
  );
}

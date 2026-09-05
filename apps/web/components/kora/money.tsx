'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { formatMoneyMinor, truncateId } from '@/lib/ops/format';
import { cn } from '@/lib/utils';

function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    },
  ];
}

export function Money({
  amountMinor,
  currency,
  className,
  large,
}: {
  amountMinor: number | null;
  currency: string | null;
  className?: string;
  large?: boolean;
}) {
  const [copied, onCopied] = useCopied();
  const text = formatMoneyMinor(amountMinor, currency);
  const payload =
    amountMinor === null ? text : `${(amountMinor / 100).toFixed(2)} ${currency ?? ''}`.trim();

  return (
    <button
      className={cn(
        'tnum inline-flex items-center gap-1.5 rounded font-mono hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        large ? 'font-semibold text-2xl' : 'text-sm',
        className,
      )}
      onClick={async () => {
        await navigator.clipboard.writeText(payload);
        onCopied();
      }}
      title={payload}
      type="button"
    >
      {text}
      {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
      <span className="sr-only">{copied ? 'Copied' : `Copy ${payload}`}</span>
    </button>
  );
}

export function StripeId({ id, className }: { id: string; className?: string }) {
  const [copied, onCopied] = useCopied();

  return (
    <button
      className={cn(
        'tnum inline-flex items-center gap-1.5 rounded font-mono text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        onCopied();
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

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * When there is nothing to roll back to, the button stays and says why in its
 * tooltip. A sentence of prose in place of a control makes the reader work out
 * whether the action exists at all.
 */
export function RollbackButton({ toVersion }: { toVersion: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rollback() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent-versions/rollback', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? `rollback failed with ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const reason =
    toVersion === null
      ? 'Nothing to roll back to yet. A version has to be archived first.'
      : `Repoints new runs at v${toVersion}. Runs already in flight finish on the version they started with.`;

  return (
    <div className="space-y-2">
      <Tooltip>
        {/* A disabled button fires no pointer events, so the span carries the
            hover that opens the tooltip explaining why it is disabled. */}
        <TooltipTrigger asChild>
          <span className="inline-block">
            <Button
              disabled={busy || toVersion === null}
              onClick={rollback}
              size="sm"
              variant="destructive"
            >
              {busy
                ? 'Rolling back…'
                : toVersion === null
                  ? 'Roll back'
                  : `Roll back to v${toVersion}`}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function RollbackButton({ toVersion }: { toVersion: number }) {
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

  return (
    <div className="space-y-2">
      <Button onClick={rollback} disabled={busy} variant="destructive">
        {busy ? 'Rolling back…' : `Roll back to v${toVersion}`}
      </Button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}

'use client';

import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TraceDto } from '@/lib/api/schemas';

export function TraceHeaderActions({ trace }: { trace: TraceDto }) {
  const [copied, setCopied] = useState(false);

  async function copyTraceId() {
    await navigator.clipboard.writeText(trace.run.traceId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${trace.run.traceId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={copyTraceId}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy trace id'}
      </Button>
      <Button variant="outline" size="sm" onClick={exportJson}>
        <Download />
        Export JSON
      </Button>
    </div>
  );
}

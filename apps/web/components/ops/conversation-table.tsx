'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ConversationPageDto, ConversationSummaryDto } from '@/lib/api/schemas';
import { formatDuration, formatUsdMicros } from '@/lib/ops/format';

function VerifiedMark({ verified }: { verified: boolean | null }) {
  if (verified === null) return <Badge variant="outline">evaluating</Badge>;
  return <Badge variant={verified ? 'default' : 'destructive'}>{verified ? 'pass' : 'fail'}</Badge>;
}

export function ConversationTable({
  page,
  apiQuery,
}: {
  page: ConversationPageDto;
  apiQuery: string;
}) {
  const [items, setItems] = useState<ConversationSummaryDto[]>(page.items);
  const [cursor, setCursor] = useState<string | null>(page.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    setError(null);

    try {
      const separator = apiQuery.length > 0 ? '&' : '';
      const res = await fetch(
        `/api/conversations?${apiQuery}${separator}cursor=${encodeURIComponent(cursor)}`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        setError(body?.error?.message ?? 'That page could not be loaded.');
        return;
      }
      const next = (await res.json()) as ConversationPageDto;
      setItems((current) => [...current, ...next.items]);
      setCursor(next.nextCursor);
    } catch {
      setError('We could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">No conversations match these filters.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Primary failure</TableHead>
              <TableHead>Escalated</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.runId} data-testid="conversation-row">
                <TableCell>
                  <Link
                    href={`/ops/conversations/${item.conversationId}?runId=${item.runId}`}
                    data-testid="trace-link"
                    className="underline underline-offset-4"
                  >
                    {new Date(item.startedAt).toLocaleString()}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{item.customer ?? '—'}</TableCell>
                <TableCell>{item.intent ?? '—'}</TableCell>
                <TableCell>{item.state ?? '—'}</TableCell>
                <TableCell>{item.outcome ?? 'in progress'}</TableCell>
                <TableCell>
                  <VerifiedMark verified={item.verifiedResolution} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {item.primaryFailureCode ?? '—'}
                </TableCell>
                <TableCell>
                  {item.escalated ? (
                    <Badge variant="secondary">{item.escalationStatus ?? 'open'}</Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{formatDuration(item.durationMs)}</TableCell>
                <TableCell className="tabular-nums">
                  {formatUsdMicros(item.costUsdMicros)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex items-center gap-3">
        {cursor ? (
          <Button onClick={loadMore} disabled={busy} variant="outline" size="sm">
            {busy ? 'Loading…' : 'Load more'}
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">End of the list.</span>
        )}
        <span className="text-muted-foreground text-xs">{items.length} shown</span>
      </div>
    </div>
  );
}

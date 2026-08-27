'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTable } from '@tanstack/react-table';
import { StatePill, VerifiedPill } from '@/components/kora/status-pill';
import { EmptyState } from '@/components/kora/states';
import {
  DataGrid,
  DataGridContainer,
  type DataGridFeatures,
  dataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridTableVirtual } from '@/components/reui/data-grid/data-grid-table-virtual';
import type { ConversationPageDto, ConversationSummaryDto } from '@/lib/api/schemas';
import { EMPTY, formatAbsolute, formatDuration, formatRelative } from '@/lib/ops/format';

/** Seven columns. Customer is the same value on every row and cost is stored in
 *  micro-dollars; both carry more in the row detail than in a column here. */
const COLUMNS: ColumnDef<DataGridFeatures, ConversationSummaryDto>[] = [
  {
    id: 'startedAt',
    accessorFn: (row) => row.startedAt,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Started" />,
    size: 130,
    cell: ({ row }) => (
      <Link
        className="underline underline-offset-4"
        data-testid="trace-link"
        href={`/ops/conversations/${row.original.conversationId}?runId=${row.original.runId}`}
        title={formatAbsolute(row.original.startedAt)}
      >
        {formatRelative(row.original.startedAt)}
      </Link>
    ),
  },
  {
    id: 'intent',
    accessorFn: (row) => row.intent ?? '',
    header: ({ column }) => <DataGridColumnHeader column={column} title="Intent" />,
    size: 170,
    cell: ({ row }) => row.original.intent ?? EMPTY,
  },
  {
    id: 'state',
    accessorFn: (row) => row.state ?? '',
    header: ({ column }) => <DataGridColumnHeader column={column} title="State" />,
    size: 150,
    cell: ({ row }) => <StatePill state={row.original.state} />,
  },
  {
    id: 'verified',
    accessorFn: (row) => row.verifiedResolution,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Verified" />,
    size: 110,
    cell: ({ row }) => (
      <VerifiedPill state={row.original.state} verified={row.original.verifiedResolution} />
    ),
  },
  {
    id: 'primaryFailureCode',
    accessorFn: (row) => row.primaryFailureCode ?? '',
    header: ({ column }) => <DataGridColumnHeader column={column} title="Primary failure" />,
    size: 190,
    cell: ({ row }) =>
      row.original.primaryFailureCode ? (
        <span className="font-mono text-xs">{row.original.primaryFailureCode}</span>
      ) : (
        EMPTY
      ),
  },
  {
    id: 'durationMs',
    accessorFn: (row) => row.durationMs ?? 0,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Duration" />,
    size: 110,
    meta: { cellClassName: 'tabular-nums' },
    cell: ({ row }) => formatDuration(row.original.durationMs),
  },
  {
    id: 'escalated',
    accessorFn: (row) => row.escalated,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Escalated" />,
    size: 120,
    cell: ({ row }) => (row.original.escalated ? (row.original.escalationStatus ?? 'open') : EMPTY),
  },
];

/**
 * The grid's own pagination is off. This list pages by keyset over an
 * accumulating array, and TanStack's default page size of ten silently sliced
 * the row model down to ten rows before the virtualizer ever saw them, so the
 * grid rendered ten rows, never scrolled, and asked for the next page
 * immediately because it believed it was already at the bottom.
 */
const ALL_ROWS = { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER };

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

  const fetchMore = useCallback(async () => {
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
  }, [apiQuery, busy, cursor]);

  const columns = useMemo(() => COLUMNS, []);
  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: items,
    getRowId: (row) => row.runId,
    state: { pagination: ALL_ROWS },
  });

  if (items.length === 0) {
    return (
      <EmptyState
        action={{ label: 'Clear the filters', href: '/ops/conversations' }}
        description="No run matches these filters. Widen the window or drop a chip to see more."
        icon={Inbox}
        title="Nothing matches"
      />
    );
  }

  return (
    <div className="space-y-3">
      <DataGrid
        recordCount={items.length}
        table={table}
        tableLayout={{ headerSticky: true, rowBorder: true, width: 'fixed' }}
      >
        <DataGridContainer>
          <DataGridTableVirtual
            estimateSize={40}
            hasMore={cursor !== null}
            height={560}
            isFetchingMore={busy}
            onFetchMore={fetchMore}
          />
        </DataGridContainer>
      </DataGrid>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {items.length.toLocaleString()} run{items.length === 1 ? '' : 's'} loaded
        {cursor === null ? ', end of the list' : ', scroll for more'}
      </p>
    </div>
  );
}

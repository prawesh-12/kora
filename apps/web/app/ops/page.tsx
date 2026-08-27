import Link from 'next/link';
import { InsightCards, type InsightCardItem } from '@/components/ops/insight-cards';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadMetrics, loadRecentRuns } from '@/lib/ops/data';

export const dynamic = 'force-dynamic';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

export default async function OverviewPage() {
  const [metrics, runs] = await Promise.all([loadMetrics(), loadRecentRuns()]);

  const rate = metrics.verifiedResolutionRate;
  const cards: InsightCardItem[] = [
    { id: 'total', label: 'Total runs', value: String(metrics.totalRuns), hint: 'last 30 days' },
    { id: 'resolved', label: 'Resolved', value: String(metrics.resolved), tone: 'positive' },
    { id: 'escalated', label: 'Escalated', value: String(metrics.escalated), tone: 'warning' },
    { id: 'failed', label: 'Failed', value: String(metrics.failed), tone: 'danger' },
    {
      id: 'verified',
      label: 'Verified resolution rate',
      value: rate === null ? '—' : `${(rate * 100).toFixed(0)}%`,
      hint: `n = ${metrics.evaluatedCount}`,
    },
    { id: 'latency', label: 'Average latency', value: formatDuration(metrics.avgLatencyMs) },
    { id: 'cost', label: 'Average cost', value: formatUsd(metrics.avgCostUsdMicros) },
  ];

  return (
    <main className="flex flex-col gap-8 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          Live numbers from the last 30 days of runs. The denominator sits next to the rate on
          purpose: a percentage over a handful of runs is not a number to act on.
        </p>
      </header>

      <InsightCards items={cards} />

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Final state</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.runId} data-testid="run-row">
                    <TableCell>
                      <Link
                        href={`/ops/conversations/${run.conversationId}?runId=${run.runId}`}
                        className="underline underline-offset-4"
                      >
                        {new Date(run.startedAt).toLocaleString()}
                      </Link>
                    </TableCell>
                    <TableCell>{run.intent ?? '—'}</TableCell>
                    <TableCell>{run.outcome ?? 'in progress'}</TableCell>
                    <TableCell>{run.finalState ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{formatDuration(run.durationMs)}</TableCell>
                    <TableCell>
                      {run.verifiedResolution === null ? (
                        <Badge variant="outline">evaluating</Badge>
                      ) : (
                        <Badge variant={run.verifiedResolution ? 'default' : 'destructive'}>
                          {run.verifiedResolution ? 'yes' : 'no'}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </main>
  );
}

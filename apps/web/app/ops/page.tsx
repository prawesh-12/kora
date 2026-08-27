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
import { formatDuration, formatRate, formatCostMicros } from '@/lib/ops/format';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [metrics, runs] = await Promise.all([loadMetrics(), loadRecentRuns()]);

  const cards: InsightCardItem[] = [
    { id: 'total', label: 'Total runs', value: String(metrics.runs.total), hint: 'last 30 days' },
    {
      id: 'verified',
      label: 'Verified resolution rate',
      value: formatRate(metrics.verifiedResolutionRate),
      hint: `n = ${metrics.runs.evaluated}, ${metrics.runs.pending} pending`,
      tone: 'positive',
    },
    {
      id: 'automation',
      label: 'Automation rate',
      value: formatRate(metrics.automationRate),
      hint: `${metrics.runs.eligible} eligible runs`,
    },
    {
      id: 'escalation',
      label: 'Escalation rate',
      value: formatRate(metrics.escalationRate),
      tone: 'warning',
    },
    {
      id: 'latency',
      label: 'Latency p50 / p95',
      value: `${formatDuration(metrics.latencyMs.p50)} / ${formatDuration(metrics.latencyMs.p95)}`,
    },
    {
      id: 'cost',
      label: 'Cost per resolution',
      value: formatCostMicros(metrics.costPerResolutionUsdMicros),
      hint: `${metrics.verifiedResolutions} verified resolutions`,
    },
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
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-medium text-lg">Recent runs</h2>
          <Link href="/ops/conversations" className="text-sm underline underline-offset-4">
            All conversations
          </Link>
        </div>
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
                    <TableCell>{run.state ?? '—'}</TableCell>
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

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { HeroStat, StatBar, Tile } from '@/components/kora/stat';
import { EmptyState } from '@/components/kora/states';
import { VerifiedPill } from '@/components/kora/status-pill';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadMetrics, loadRecentRuns } from '@/lib/ops/data';
import {
  EMPTY,
  formatAbsolute,
  formatDuration,
  formatRate,
  formatRelative,
} from '@/lib/ops/format';

export const dynamic = 'force-dynamic';

const RECENT_RUNS = 10;

/**
 * Deliberately smaller than Evaluations.
 *
 * The two pages used to show the same five metrics, so there was no reason to
 * visit both. Overview answers "is it working right now"; Evaluations answers
 * "why", and owns latency, cost, grounding, tool success and coverage.
 */
export default async function OverviewPage() {
  const [metrics, runs] = await Promise.all([loadMetrics(), loadRecentRuns(RECENT_RUNS)]);

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          The last 30 days. The denominator sits next to the rate on purpose: a percentage over a
          handful of runs is not a number to act on.
        </p>
      </header>

      <HeroStat
        context={`${metrics.runs.evaluated.toLocaleString()} evaluated \u00b7 ${metrics.runs.pending.toLocaleString()} pending`}
        label="Verified resolution rate"
        tone={metrics.verifiedResolutionRate === null ? 'default' : 'ok'}
        value={formatRate(metrics.verifiedResolutionRate)}
      />

      <StatBar columns={3}>
        <Tile label="Total runs" sub="in the window" value={metrics.runs.total.toLocaleString()} />
        <Tile
          label="Eligible runs"
          sub="the agent was allowed to resolve these"
          value={metrics.runs.eligible.toLocaleString()}
        />
        <Tile
          label="Escalation rate"
          sub="handed to a person"
          tone="warn"
          value={formatRate(metrics.escalationRate)}
        />
      </StatBar>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Recent runs</h2>

        {runs.length === 0 ? (
          <EmptyState
            action={{ label: 'Open the customer chat', href: '/chat' }}
            description="Runs appear here as soon as a customer sends a message. Start a conversation to see one."
            icon={Inbox}
            title="No runs yet"
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Final state</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Verified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      className="h-10 transition-colors hover:bg-muted/50"
                      data-testid="run-row"
                      key={run.runId}
                    >
                      <TableCell className="text-sm">
                        <Link
                          className="underline underline-offset-4"
                          href={`/ops/conversations/${run.conversationId}?runId=${run.runId}`}
                          title={formatAbsolute(run.startedAt)}
                        >
                          {formatRelative(run.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{run.intent ?? EMPTY}</TableCell>
                      <TableCell className="text-sm">
                        {run.state?.toLowerCase().replace(/_/g, ' ') ?? EMPTY}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatDuration(run.durationMs)}
                      </TableCell>
                      <TableCell>
                        <VerifiedPill state={run.state} verified={run.verifiedResolution} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-center pt-1">
              <Button asChild size="sm" variant="outline">
                <Link href="/ops/conversations">View all conversations</Link>
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

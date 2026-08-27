import { INTENTS, type Intent } from '@kora/core';
import { HeroStat, StatBar, Tile } from '@/components/kora/stat';
import { FailureChart } from '@/components/ops/failure-chart';
import { VrrTrend } from '@/components/ops/vrr-trend';
import { loadFailureBreakdown, loadMetrics } from '@/lib/ops/data';
import { formatCostMicros, formatDuration, formatRate } from '@/lib/ops/format';

export const dynamic = 'force-dynamic';

const MAX_WINDOW_DAYS = 90;

function windowDays(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  return Math.min(Math.trunc(parsed), MAX_WINDOW_DAYS);
}

function intentOf(raw: string | undefined): Intent | undefined {
  return INTENTS.find((i) => i === raw);
}

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; intent?: string; agentConfigVersion?: string }>;
}) {
  const params = await searchParams;
  const days = windowDays(params.days);
  const intent = intentOf(params.intent);

  const query = {
    days,
    ...(intent ? { intent } : {}),
    ...(params.agentConfigVersion ? { agentConfigVersion: params.agentConfigVersion } : {}),
  };

  const [metrics, failures] = await Promise.all([loadMetrics(query), loadFailureBreakdown(query)]);

  const trend = metrics.trend.filter((p) => p.rate !== null);
  const from = metrics.window.from.slice(0, 10);
  const to = metrics.window.to.slice(0, 10);

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Evaluations</h1>
        <p className="text-muted-foreground text-sm">
          Last {days} days, {from} to {to}. Runs that asked for a human or fell outside the agent's
          scope are reported as coverage, not counted against the resolution rate. Runs still
          waiting on an evaluation are pending, never failures.
        </p>
      </header>

      <HeroStat
        aside={
          trend.length < 2 ? (
            <span className="text-muted-foreground text-xs">
              {trend.length === 0
                ? 'no evaluated runs yet, so there is no trend'
                : 'one day of data so far, a trend needs two'}
            </span>
          ) : null
        }
        context={`${metrics.runs.evaluated.toLocaleString()} evaluated \u00b7 ${metrics.runs.pending.toLocaleString()} pending`}
        label="Verified resolution rate"
        tone={metrics.verifiedResolutionRate === null ? 'default' : 'ok'}
        value={formatRate(metrics.verifiedResolutionRate)}
      />

      <StatBar columns={4}>
        <Tile
          label="Policy compliance"
          sub="nothing a rule denied ever executed"
          tone={metrics.policyComplianceRate === 1 ? 'ok' : 'danger'}
          value={formatRate(metrics.policyComplianceRate)}
        />
        <Tile
          label="Automation"
          sub={`${metrics.runs.eligible.toLocaleString()} eligible runs`}
          value={formatRate(metrics.automationRate)}
        />
        <Tile
          label="Escalation"
          sub="handed to a person"
          tone="warn"
          value={formatRate(metrics.escalationRate)}
        />
        <Tile
          label="Tool success"
          sub="calls that returned a result"
          value={formatRate(metrics.toolSuccessRate)}
        />
        <Tile
          label="Grounding"
          sub="every id and amount came from a tool result"
          value={formatRate(metrics.groundingRate)}
        />
        <Tile
          label="Latency"
          sub="p50 and p95"
          value={`${formatDuration(metrics.latencyMs.p50)} / ${formatDuration(metrics.latencyMs.p95)}`}
        />
        <Tile
          label="Cost per resolution"
          sub={`${metrics.verifiedResolutions.toLocaleString()} verified resolutions`}
          value={formatCostMicros(metrics.costPerResolutionUsdMicros)}
        />
        <Tile
          label="Coverage"
          sub={`${metrics.coverage.humanRequest} asked for a human, ${metrics.coverage.outOfScope} out of scope`}
          value={formatRate(metrics.coverage.rate)}
        />
      </StatBar>

      {trend.length >= 2 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium text-lg">Verified resolution over time</h2>
            <span className="text-muted-foreground text-xs">
              {metrics.verifiedResolutions.toLocaleString()} of{' '}
              {metrics.runs.evaluated.toLocaleString()} evaluated runs
            </span>
          </div>
          <VrrTrend points={trend} />
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-medium text-lg">Failures by root cause</h2>
          <p className="text-muted-foreground text-sm">
            One bar per primary failure code. Length is how often it happened; colour is how serious
            it is, so the rarest code can still be the loudest row. Open a bar to see every
            conversation behind it.
          </p>
        </div>
        <FailureChart buckets={failures} days={days} />
      </section>
    </div>
  );
}

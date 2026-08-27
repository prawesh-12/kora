import { INTENTS, type Intent } from '@kora/core';
import { Stat, StatGrid } from '@/components/kora/stat';
import { FailureChart } from '@/components/ops/failure-chart';
import { VrrTrend } from '@/components/ops/vrr-trend';
import { loadFailureBreakdown, loadMetrics } from '@/lib/ops/data';
import { NO_DATA, formatCostMicros, formatDuration, formatRate } from '@/lib/ops/format';

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

  const from = metrics.window.from.slice(0, 10);
  const to = metrics.window.to.slice(0, 10);

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Evaluations</h1>
        <p className="text-muted-foreground text-sm">
          Last {days} days, {from} to {to}. Runs that asked for a human or fell outside the agent's
          scope are reported as coverage, not counted against the resolution rate. Runs still
          waiting on an evaluation are pending, never failures.
        </p>
      </header>

      <StatGrid>
        <Stat
          hero
          hint={`${metrics.runs.evaluated} evaluated, ${metrics.runs.pending} still pending`}
          label="Verified resolution rate"
          tone={metrics.verifiedResolutionRate === null ? 'default' : 'ok'}
          value={formatRate(metrics.verifiedResolutionRate)}
        />
        <Stat
          hint="nothing a rule denied ever executed"
          label="Policy compliance"
          tone={metrics.policyComplianceRate === 1 ? 'ok' : 'danger'}
          value={formatRate(metrics.policyComplianceRate)}
        />
        <Stat
          hint={`${metrics.runs.eligible} eligible runs`}
          label="Automation rate"
          value={formatRate(metrics.automationRate)}
        />
        <Stat
          hint="handed to a person"
          label="Escalation rate"
          tone="warn"
          value={formatRate(metrics.escalationRate)}
        />
        <Stat label="Tool success rate" value={formatRate(metrics.toolSuccessRate)} />
        <Stat
          hint="every id and amount came from a tool result"
          label="Grounding rate"
          value={formatRate(metrics.groundingRate)}
        />
        <Stat
          hint="p50 and p95"
          label="Latency"
          value={`${formatDuration(metrics.latencyMs.p50)} / ${formatDuration(metrics.latencyMs.p95)}`}
        />
        <Stat
          hint={`${metrics.verifiedResolutions} verified resolutions`}
          label="Cost per resolution"
          value={formatCostMicros(metrics.costPerResolutionUsdMicros)}
        />
        <Stat
          hint={`${metrics.coverage.humanRequest} asked for a human, ${metrics.coverage.outOfScope} out of scope`}
          label="Coverage"
          value={formatRate(metrics.coverage.rate)}
        />
      </StatGrid>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium text-lg">Verified resolution over time</h2>
          <span className="text-muted-foreground text-xs">
            {metrics.verifiedResolutionRate === null
              ? NO_DATA
              : `${metrics.verifiedResolutions} of ${metrics.runs.evaluated} evaluated runs`}
          </span>
        </div>
        <VrrTrend points={metrics.trend} />
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-medium text-lg">Failures by root cause</h2>
          <p className="text-muted-foreground text-sm">
            One bar per primary failure code. Length is how often it happened; colour is how serious
            it is, so the rarest code can still be the loudest row. Open a bar to see every
            conversation behind it.
          </p>
        </div>
        <FailureChart buckets={failures} from={from} to={to} />
      </section>
    </main>
  );
}

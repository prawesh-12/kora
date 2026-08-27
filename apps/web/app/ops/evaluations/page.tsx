import { INTENTS, type Intent } from '@kora/core';
import { FailureChart } from '@/components/ops/failure-chart';
import { InsightCards, type InsightCardItem } from '@/components/ops/insight-cards';
import { VrrTrend } from '@/components/ops/vrr-trend';
import { loadFailureBreakdown, loadMetrics } from '@/lib/ops/data';
import { NO_DATA, formatDuration, formatRate, formatUsdMicros } from '@/lib/ops/format';

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

  const cards: InsightCardItem[] = [
    {
      id: 'vrr',
      label: 'Verified resolution rate',
      value: formatRate(metrics.verifiedResolutionRate),
      hint: `n = ${metrics.runs.evaluated}, ${metrics.runs.pending} pending`,
      tone: metrics.verifiedResolutionRate === null ? 'default' : 'positive',
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
      id: 'policy',
      label: 'Policy compliance',
      value: formatRate(metrics.policyComplianceRate),
    },
    { id: 'tools', label: 'Tool success rate', value: formatRate(metrics.toolSuccessRate) },
    { id: 'grounding', label: 'Grounding rate', value: formatRate(metrics.groundingRate) },
    {
      id: 'latency',
      label: 'Latency p50 / p95',
      value: `${formatDuration(metrics.latencyMs.p50)} / ${formatDuration(metrics.latencyMs.p95)}`,
    },
    {
      id: 'cost',
      label: 'Cost per resolution',
      value: formatUsdMicros(metrics.costPerResolutionUsdMicros),
      hint: `${metrics.verifiedResolutions} verified resolutions`,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      value: formatRate(metrics.coverage.rate),
      hint: `${metrics.coverage.humanRequest} asked for a human, ${metrics.coverage.outOfScope} out of scope`,
    },
  ];

  const from = metrics.window.from.slice(0, 10);
  const to = metrics.window.to.slice(0, 10);

  return (
    <main className="flex flex-col gap-8 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Evaluations</h1>
        <p className="text-muted-foreground text-sm">
          Last {days} days, {from} to {to}. Runs that asked for a human or fell outside the agent's
          scope are reported as coverage, not counted against the resolution rate. Runs still
          waiting on an evaluation are pending, never failures.
        </p>
      </header>

      <InsightCards items={cards} />

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
            One bar per primary failure code. Open a bar to see every conversation behind it.
          </p>
        </div>
        <FailureChart buckets={failures} from={from} to={to} />
      </section>
    </main>
  );
}

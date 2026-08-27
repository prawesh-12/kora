import { now, serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { handle } from '@/lib/api/errors';
import { MetricsQuery, parseQuery } from '@/lib/api/schemas';
import type { MetricsDto } from '@/lib/api/schemas';

const DEFAULT_WINDOW_DAYS = 30;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireOperator();

    const { from, to } = parseQuery(req.url, MetricsQuery);
    const until = to ?? now();
    const since = from ?? new Date(until.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const repos = withTenant(serverEnv().KORA_TENANT_ID);
    const runs = await repos.runs.listBetween(since, until);
    const evaluations = await repos.evaluations.forRuns(runs.map((r) => r.id));

    const evaluatedCount = evaluations.length;
    const verified = evaluations.filter((e) => e.verifiedResolution).length;

    const dto: MetricsDto = {
      totalRuns: runs.length,
      resolved: runs.filter((r) => r.outcome === 'resolved_automatically').length,
      escalated: runs.filter((r) => r.outcome === 'escalated').length,
      failed: runs.filter((r) => r.outcome === 'failed').length,
      verifiedResolutionRate: evaluatedCount === 0 ? null : verified / evaluatedCount,
      evaluatedCount,
      avgLatencyMs: mean(runs.map((r) => r.durationMs).filter((d): d is number => d !== null)),
      avgCostUsdMicros: mean(runs.map((r) => Number(r.costUsdMicros))),
    };
    return Response.json(dto);
  });
}

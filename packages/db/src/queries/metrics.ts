import type { FailureCode, Intent } from '@kora/core';
import { type SQL, sql } from 'drizzle-orm';
import { db } from '../client.js';

export interface MetricsFilter {
  tenantId: string;
  from: Date;
  to: Date;
  intent?: Intent | undefined;
  agentConfigVersion?: string | undefined;
}

export interface Metrics {
  window: { from: string; to: string };
  runs: { total: number; eligible: number; evaluated: number; pending: number };
  coverage: { inScope: number; outOfScope: number; humanRequest: number; rate: number | null };
  automationRate: number | null;
  escalationRate: number | null;
  verifiedResolutionRate: number | null;
  verifiedResolutions: number;
  policyComplianceRate: number | null;
  toolSuccessRate: number | null;
  groundingRate: number | null;
  latencyMs: { p50: number | null; p95: number | null };
  totalCostUsdMicros: number;
  costPerResolutionUsdMicros: number | null;
}

export interface VrrPoint {
  day: string;
  runs: number;
  evaluated: number;
  verified: number;
  rate: number | null;
}

export interface FailureBucket {
  code: FailureCode;
  count: number;
  topDetail: string;
}

/**
 * A run whose intent was `OUT_OF_SCOPE` or `HUMAN_REQUEST` was never the agent's to
 * resolve. Counting those as unresolved makes the rate track how many people asked
 * for a human rather than how well the agent works. They are reported as coverage.
 */
const ELIGIBLE = sql`(r.intent is null or r.intent not in ('OUT_OF_SCOPE', 'HUMAN_REQUEST'))`;

/** A raw `sql` parameter skips drizzle's type mapping, so timestamps go over as text. */
const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;

function runScope(f: MetricsFilter): SQL {
  const parts: SQL[] = [
    sql`r.tenant_id = ${f.tenantId}`,
    sql`r.started_at >= ${ts(f.from)}`,
    sql`r.started_at <= ${ts(f.to)}`,
  ];
  if (f.intent) parts.push(sql`r.intent = ${f.intent}`);
  if (f.agentConfigVersion) parts.push(sql`r.agent_config_version = ${f.agentConfigVersion}`);
  return sql.join(parts, sql` and `);
}

export function runAggregateSql(f: MetricsFilter): SQL {
  const scope = runScope(f);
  return sql`
    select
      count(*)::int as total_runs,
      count(*) filter (where ${ELIGIBLE})::int as eligible_runs,
      count(*) filter (where r.intent = 'OUT_OF_SCOPE')::int as out_of_scope_runs,
      count(*) filter (where r.intent = 'HUMAN_REQUEST')::int as human_request_runs,
      count(*) filter (where ${ELIGIBLE} and r.outcome = 'resolved_automatically')::int as resolved,
      count(*) filter (where ${ELIGIBLE} and r.outcome = 'escalated')::int as escalated,
      coalesce(sum(r.cost_usd_micros) filter (where ${ELIGIBLE}), 0)::bigint as cost_usd_micros,
      percentile_cont(0.5) within group (order by r.duration_ms)
        filter (where r.duration_ms is not null) as p50_ms,
      percentile_cont(0.95) within group (order by r.duration_ms)
        filter (where r.duration_ms is not null) as p95_ms
    from agent_runs r
    where ${scope}
  `;
}

export function evaluationAggregateSql(f: MetricsFilter): SQL {
  return sql`
    select
      count(*)::int as evaluated,
      count(*) filter (where e.verified_resolution)::int as verified
    from evaluations e
    join agent_runs r on r.id = e.run_id
    where ${runScope(f)} and ${ELIGIBLE}
  `;
}

export function checkVerdictSql(f: MetricsFilter): SQL {
  return sql`
    select
      er.check_id,
      count(*) filter (where er.verdict = 'MET')::int as met,
      count(*) filter (where er.verdict = 'UNMET')::int as unmet
    from evaluation_results er
    join evaluations e on e.id = er.evaluation_id
    join agent_runs r on r.id = e.run_id
    where ${runScope(f)} and ${ELIGIBLE}
      and er.check_id in ('policy_compliance', 'response_grounded')
    group by er.check_id
  `;
}

export function toolSuccessSql(f: MetricsFilter): SQL {
  return sql`
    select
      count(*)::int as total,
      count(*) filter (where te.status in ('ok', 'replayed'))::int as succeeded
    from tool_executions te
    join agent_runs r on r.id = te.run_id
    where ${runScope(f)}
  `;
}

export function vrrTrendSql(f: MetricsFilter): SQL {
  return sql`
    select
      to_char(date_trunc('day', r.started_at), 'YYYY-MM-DD') as day,
      count(*)::int as runs,
      count(e.id)::int as evaluated,
      count(*) filter (where e.verified_resolution)::int as verified
    from agent_runs r
    left join evaluations e on e.run_id = r.id
    where ${runScope(f)} and ${ELIGIBLE}
    group by 1
    order by 1
  `;
}

/**
 * Only `failure_codes[1]` is counted. The classifier writes every code it finds in
 * root-cause order, so counting all of them would count one broken retrieval again
 * as a hallucination and again as a bad outcome, and the tallest bar would be the
 * symptom furthest from the fix.
 *
 * `top_detail` is recomputed from the trace rather than read back, because the
 * detail the classifier produced is not persisted alongside the code.
 */
export function failureBreakdownSql(f: MetricsFilter): SQL {
  return sql`
    with primary_failure as (
      select r.id as run_id, r.intent, e.failure_codes[1] as code
      from evaluations e
      join agent_runs r on r.id = e.run_id
      where ${runScope(f)} and array_length(e.failure_codes, 1) > 0
    ),
    detailed as (
      select
        p.code,
        coalesce(
          case
            when p.code in ('TOOL_EXECUTION_FAILURE', 'TOOL_SELECTION_FAILURE', 'ARGUMENT_FAILURE')
              then (
                select te.tool_name || ' / ' || lower(coalesce(te.error_code, 'unknown'))
                from tool_executions te
                where te.run_id = p.run_id and te.status <> 'ok' and te.status <> 'replayed'
                order by te.started_at desc
                limit 1
              )
            when p.code = 'POLICY_FAILURE'
              then (
                -- The rule id "default" is the engine's sentinel for no rule
                -- matched, so the bundle default applied. Reporting it tells an
                -- engineer nothing. The reason behind it names the missing
                -- facts, which is the thing they would go and fix.
                select case when pc.rule_id = 'default' then pc.reason else pc.rule_id end
                from policy_checks pc
                where pc.run_id = p.run_id and pc.decision <> 'allow'
                order by pc.created_at desc
                limit 1
              )
            else null
          end,
          p.intent,
          'no dominant cause'
        ) as detail
      from primary_failure p
    )
    select code, count(*)::int as n, mode() within group (order by detail) as top_detail
    from detailed
    group by code
    order by n desc, code asc
  `;
}

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db().execute(query)) as unknown as T[];
}

const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const num = (v: unknown): number => Number(v ?? 0);
const maybeNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

interface RunAggregateRow {
  total_runs: number;
  eligible_runs: number;
  out_of_scope_runs: number;
  human_request_runs: number;
  resolved: number;
  escalated: number;
  cost_usd_micros: string | number;
  p50_ms: string | number | null;
  p95_ms: string | number | null;
}

export async function computeMetrics(f: MetricsFilter): Promise<Metrics> {
  const [runRows, evalRows, checkRows, toolRows] = await Promise.all([
    rows<RunAggregateRow>(runAggregateSql(f)),
    rows<{ evaluated: number; verified: number }>(evaluationAggregateSql(f)),
    rows<{ check_id: string; met: number; unmet: number }>(checkVerdictSql(f)),
    rows<{ total: number; succeeded: number }>(toolSuccessSql(f)),
  ]);

  const runs = runRows[0];
  const evaluations = evalRows[0];
  const tools = toolRows[0];

  const total = num(runs?.total_runs);
  const eligible = num(runs?.eligible_runs);
  const resolved = num(runs?.resolved);
  const escalated = num(runs?.escalated);
  const evaluated = num(evaluations?.evaluated);
  const verified = num(evaluations?.verified);
  const cost = num(runs?.cost_usd_micros);

  const verdictRate = (checkId: string): number | null => {
    const row = checkRows.find((c) => c.check_id === checkId);
    if (!row) return null;
    return rate(num(row.met), num(row.met) + num(row.unmet));
  };

  return {
    window: { from: f.from.toISOString(), to: f.to.toISOString() },
    runs: { total, eligible, evaluated, pending: Math.max(eligible - evaluated, 0) },
    coverage: {
      inScope: eligible,
      outOfScope: num(runs?.out_of_scope_runs),
      humanRequest: num(runs?.human_request_runs),
      rate: rate(eligible, total),
    },
    automationRate: rate(resolved, eligible),
    escalationRate: rate(escalated, eligible),
    verifiedResolutionRate: rate(verified, evaluated),
    verifiedResolutions: verified,
    policyComplianceRate: verdictRate('policy_compliance'),
    toolSuccessRate: rate(num(tools?.succeeded), num(tools?.total)),
    groundingRate: verdictRate('response_grounded'),
    latencyMs: {
      p50: maybeNum(runs?.p50_ms ?? null),
      p95: maybeNum(runs?.p95_ms ?? null),
    },
    totalCostUsdMicros: cost,
    // Dividing by conversations rewards an agent that resolves less, because the
    // cheap unresolved runs land in the denominator. Verified resolutions do not.
    costPerResolutionUsdMicros: verified === 0 ? null : Math.round(cost / verified),
  };
}

export async function vrrTrend(f: MetricsFilter): Promise<VrrPoint[]> {
  const points = await rows<{
    day: string;
    runs: number;
    evaluated: number;
    verified: number;
  }>(vrrTrendSql(f));

  return points.map((p) => ({
    day: p.day,
    runs: num(p.runs),
    evaluated: num(p.evaluated),
    verified: num(p.verified),
    rate: rate(num(p.verified), num(p.evaluated)),
  }));
}

export async function failureBreakdown(f: MetricsFilter): Promise<FailureBucket[]> {
  const buckets = await rows<{ code: string; n: number; top_detail: string | null }>(
    failureBreakdownSql(f),
  );

  return buckets.map((b) => ({
    code: b.code as FailureCode,
    count: num(b.n),
    topDetail: b.top_detail ?? 'unknown',
  }));
}

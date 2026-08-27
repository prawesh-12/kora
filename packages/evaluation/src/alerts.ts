import { computeMetrics, sql, vrrTrend } from '@kora/db';

export type Severity = 'page' | 'warn';

export interface AlertResult {
  ruleId: string;
  severity: Severity;
  firing: boolean;
  detail: string;
  /** Where an operator goes next. An alert with no drill path gets ignored within a week. */
  drillUrl: string;
}

export interface AlertWindow {
  tenantId: string;
  from: Date;
  to: Date;
  /**
   * Injected because the queue and the breaker live outside this package, and
   * inverting that would make `evaluation` depend on the worker it evaluates.
   * Absent means the two rules that need them are skipped, not fired.
   */
  probes?: {
    failedJobCounts?(): Promise<Record<string, number>>;
    openBreakers?(): Promise<Array<{ key: string; openForMs: number }>>;
  };
}

interface Rule {
  id: string;
  severity: Severity;
  evaluate(w: AlertWindow): Promise<Omit<AlertResult, 'ruleId' | 'severity'>>;
}

function quiet(drillUrl: string, detail: string): Omit<AlertResult, 'ruleId' | 'severity'> {
  return { firing: false, detail, drillUrl };
}

const POLICY_COMPLIANCE_FLOOR = 0.99;
const VRR_DROP_POINTS = 0.1;
const BREAKER_OPEN_LIMIT_MS = 5 * 60_000;
const JUDGE_SPEND_SHARE = 0.25;
const KAPPA_FLOOR = 0.6;

/**
 * A run with a critical check unmet is the system doing the wrong thing, not
 * doing it slowly. It pages.
 */
const criticalCheckUnmet: Rule = {
  id: 'critical_check_unmet',
  severity: 'page',
  async evaluate(w) {
    const drillUrl = `/ops/conversations?days=1&verified=false`;
    const rows = await sql()<{ n: string; check_id: string }[]>`
      SELECT count(*) AS n, r.check_id
      FROM evaluation_results r
      JOIN evaluations e ON e.id = r.evaluation_id
      JOIN agent_runs run ON run.id = e.run_id
      WHERE e.tenant_id = ${w.tenantId}
        AND r.critical = true AND r.verdict = 'UNMET'
        AND run.deployment_mode IN ('limited', 'full')
        AND e.created_at >= ${w.from.toISOString()}::timestamptz
        AND e.created_at < ${w.to.toISOString()}::timestamptz
      GROUP BY r.check_id ORDER BY n DESC LIMIT 1`;

    const top = rows[0];
    if (!top) return quiet(drillUrl, 'no critical check failed in production');
    return {
      firing: true,
      detail: `${top.n} run(s) failed the critical check ${top.check_id}`,
      drillUrl,
    };
  },
};

const policyComplianceBelowFloor: Rule = {
  id: 'policy_compliance_below_floor',
  severity: 'page',
  async evaluate(w) {
    const drillUrl = '/ops/evaluations?days=1';
    const m = await computeMetrics({ tenantId: w.tenantId, from: w.from, to: w.to });

    // Missing data is not a healthy system and it is not a broken one either.
    // `missing_rollup` covers the empty window; firing here would cry wolf.
    if (m.policyComplianceRate === null) {
      return quiet(drillUrl, 'no evaluated runs in the window');
    }
    return m.policyComplianceRate < POLICY_COMPLIANCE_FLOOR
      ? {
          firing: true,
          detail: `policy compliance is ${(m.policyComplianceRate * 100).toFixed(1)}%, below ${POLICY_COMPLIANCE_FLOOR * 100}%`,
          drillUrl,
        }
      : quiet(drillUrl, `policy compliance is ${(m.policyComplianceRate * 100).toFixed(1)}%`);
  },
};

const vrrDroppedDayOverDay: Rule = {
  id: 'vrr_dropped',
  severity: 'page',
  async evaluate(w) {
    const drillUrl = '/ops/evaluations?days=7';
    const points = await vrrTrend({
      tenantId: w.tenantId,
      from: new Date(w.to.getTime() - 2 * 86_400_000),
      to: w.to,
    });

    const withRate = points.filter((p) => p.rate !== null);
    const today = withRate.at(-1);
    const yesterday = withRate.at(-2);
    if (!today || !yesterday) return quiet(drillUrl, 'not enough days to compare');

    const drop = (yesterday.rate ?? 0) - (today.rate ?? 0);
    return drop > VRR_DROP_POINTS
      ? {
          firing: true,
          detail: `verified resolution fell ${(drop * 100).toFixed(1)} points, ${((yesterday.rate ?? 0) * 100).toFixed(1)}% to ${((today.rate ?? 0) * 100).toFixed(1)}%`,
          drillUrl,
        }
      : quiet(drillUrl, `verified resolution moved ${(-drop * 100).toFixed(1)} points`);
  },
};

/**
 * A write that executed and could not be read back. The customer may already
 * have been told it happened, which is why this pages rather than warns.
 */
const unverifiedWrite: Rule = {
  id: 'unverified_write',
  severity: 'page',
  async evaluate(w) {
    const drillUrl = '/ops/conversations?days=1&verified=false';
    const rows = await sql()<{ n: string; run_id: string; conversation_id: string }[]>`
      SELECT count(*) OVER () AS n, t.run_id, r.conversation_id
      FROM tool_executions t
      JOIN agent_runs r ON r.id = t.run_id
      WHERE t.tenant_id = ${w.tenantId}
        AND t.status = 'ok' AND t.verified = false
        AND t.started_at >= ${w.from.toISOString()}::timestamptz
        AND t.started_at < ${w.to.toISOString()}::timestamptz
      ORDER BY t.started_at DESC
      LIMIT 1`;

    const row = rows[0];
    if (!row) return quiet(drillUrl, 'every write in the window read back');
    // Straight to the trace, not to a list. This one has a single obvious next step.
    return {
      firing: true,
      detail: `${row.n} write(s) executed but could not be verified, latest on run ${row.run_id}`,
      drillUrl: `/ops/conversations/${row.conversation_id}`,
    };
  },
};

const deadLetterQueueNotEmpty: Rule = {
  id: 'dlq_not_empty',
  severity: 'warn',
  async evaluate(w) {
    // The queue depths live in the status endpoint; there is no queue page.
    const drillUrl = '/api/status';
    const probe = w.probes?.failedJobCounts;
    if (!probe) return quiet(drillUrl, 'no queue probe was supplied, so the queue was not checked');
    const counts = await probe();
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    return total > 0
      ? {
          firing: true,
          detail: `${total} failed job(s): ${Object.entries(counts)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')}`,
          drillUrl,
        }
      : quiet(drillUrl, 'no failed jobs');
  },
};

const breakerOpenTooLong: Rule = {
  id: 'breaker_open',
  severity: 'warn',
  async evaluate(w) {
    const drillUrl = '/api/status';
    const probe = w.probes?.openBreakers;
    if (!probe) {
      return quiet(drillUrl, 'no breaker probe was supplied, so breakers were not checked');
    }
    const open = await probe();
    const stuck = open.filter((b) => b.openForMs > BREAKER_OPEN_LIMIT_MS);
    return stuck.length > 0
      ? {
          firing: true,
          detail: stuck
            .map((b) => `${b.key} open for ${Math.round(b.openForMs / 60_000)}min`)
            .join(', '),
          drillUrl,
        }
      : quiet(drillUrl, `${open.length} breaker(s) open, none past the limit`);
  },
};

/** A judge that costs more than a quarter of the agent is not worth its evidence. */
const judgeSpendTooHigh: Rule = {
  id: 'judge_spend_high',
  severity: 'warn',
  async evaluate(w) {
    const drillUrl = '/ops/evaluations?days=1';
    // Agent spend comes from `agent_runs`, not `llm_calls`: the agent loop is run
    // by the SDK and its usage is accounted on the run, not call by call.
    const rows = await sql()<{ judge: string; agent: string }[]>`
      SELECT
        (SELECT coalesce(sum(cost_usd_micros), 0) FROM llm_calls
         WHERE tenant_id = ${w.tenantId} AND purpose = 'judge'
           AND created_at >= ${w.from.toISOString()}::timestamptz
           AND created_at < ${w.to.toISOString()}::timestamptz) AS judge,
        (SELECT coalesce(sum(cost_usd_micros), 0) FROM agent_runs
         WHERE tenant_id = ${w.tenantId}
           AND started_at >= ${w.from.toISOString()}::timestamptz
           AND started_at < ${w.to.toISOString()}::timestamptz) AS agent`;

    const judge = Number(rows[0]?.judge ?? 0);
    const agent = Number(rows[0]?.agent ?? 0);
    if (agent === 0) return quiet(drillUrl, 'no agent spend in the window');

    const share = judge / agent;
    return share > JUDGE_SPEND_SHARE
      ? {
          firing: true,
          detail: `the judge cost ${(share * 100).toFixed(0)}% of agent spend`,
          drillUrl,
        }
      : quiet(drillUrl, `the judge cost ${(share * 100).toFixed(0)}% of agent spend`);
  },
};

/**
 * The window is empty when the evaluation worker has stopped. Every other rule
 * goes quiet on missing data, so without this one a dead worker looks healthy.
 */
const missingRollup: Rule = {
  id: 'missing_rollup',
  severity: 'page',
  async evaluate(w) {
    const drillUrl = '/ops/evaluations?days=1';
    const rows = await sql()<{ runs: string; evaluated: string }[]>`
      SELECT
        count(*) AS runs,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM evaluations e WHERE e.run_id = r.id)) AS evaluated
      FROM agent_runs r
      WHERE r.tenant_id = ${w.tenantId}
        AND r.finished_at IS NOT NULL
        AND r.started_at >= ${w.from.toISOString()}::timestamptz
        AND r.started_at < ${w.to.toISOString()}::timestamptz`;

    const runs = Number(rows[0]?.runs ?? 0);
    const evaluated = Number(rows[0]?.evaluated ?? 0);
    if (runs === 0) return quiet(drillUrl, 'no runs finished in the window');
    return evaluated === 0
      ? {
          firing: true,
          detail: `${runs} run(s) finished and none was evaluated; the evaluation worker is not running`,
          drillUrl,
        }
      : quiet(drillUrl, `${evaluated} of ${runs} run(s) evaluated`);
  },
};

export const ALERT_RULES: Rule[] = [
  criticalCheckUnmet,
  policyComplianceBelowFloor,
  vrrDroppedDayOverDay,
  unverifiedWrite,
  missingRollup,
  deadLetterQueueNotEmpty,
  breakerOpenTooLong,
  judgeSpendTooHigh,
];

export const KAPPA_ALERT_FLOOR = KAPPA_FLOOR;

export async function evaluateAlerts(args: {
  tenantId: string;
  windowMs?: number;
  probes?: AlertWindow['probes'];
}): Promise<AlertResult[]> {
  const to = new Date();
  const from = new Date(to.getTime() - (args.windowMs ?? 3_600_000));
  const w: AlertWindow = {
    tenantId: args.tenantId,
    from,
    to,
    ...(args.probes ? { probes: args.probes } : {}),
  };

  const results: AlertResult[] = [];
  for (const rule of ALERT_RULES) {
    try {
      results.push({ ruleId: rule.id, severity: rule.severity, ...(await rule.evaluate(w)) });
    } catch (e) {
      // A rule that cannot run is itself a problem worth showing, but it is not
      // evidence that the thing it watches is broken.
      results.push({
        ruleId: rule.id,
        severity: 'warn',
        firing: true,
        detail: `the rule could not be evaluated: ${(e as Error).message}`,
        drillUrl: '/ops',
      });
    }
  }
  return results;
}

export function renderAlerts(results: AlertResult[]): string {
  const firing = results.filter((r) => r.firing);
  const lines = [
    firing.length === 0
      ? 'Nothing firing.'
      : `${firing.length} alert(s) firing, most serious first:`,
  ];

  for (const r of [...firing].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'page' ? -1 : 1,
  )) {
    lines.push(`  [${r.severity}] ${r.ruleId}`, `      ${r.detail}`, `      drill: ${r.drillUrl}`);
  }

  lines.push('', 'Quiet:');
  for (const r of results.filter((r) => !r.firing)) {
    lines.push(`  ${r.ruleId.padEnd(30)} ${r.detail}`);
  }

  return lines.join('\n');
}

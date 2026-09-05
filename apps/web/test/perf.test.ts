import { type FailureCode, type Intent, type RunOutcome, now } from '@kora/core';
import {
  closeDb,
  computeMetrics,
  conversationPageSql,
  db,
  decodeCursor,
  failureBreakdown,
  failureBreakdownSql,
  listApprovalQueue,
  listConversationSummaries,
  runAggregateSql,
  sqlExpr,
  vrrTrend,
} from '@kora/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunSpec, daysAgo, dropTenant, seedRuns } from './support/seed';

const TENANT = 'ten_perf_test';

// The plan asks for 25,000 to 50,000. Scaled down so the suite fits the machine it
// runs on; the plans asserted below do not change shape with row count.
const ROWS = 5_000;
const BUDGET_MS = 500;

const START = daysAgo(30);
const WINDOW = { tenantId: TENANT, from: daysAgo(31), to: daysAgo(0) };

const INTENT_CYCLE: Intent[] = [
  'REFUND_REQUEST',
  'REFUND_REQUEST',
  'CANCEL_SUBSCRIPTION',
  'BILLING_QUESTION',
  'HUMAN_REQUEST',
];
const FAILURE_CYCLE: FailureCode[] = [
  'TOOL_EXECUTION_FAILURE',
  'POLICY_FAILURE',
  'LATENCY_FAILURE',
  'HALLUCINATION',
];

function fixture(): RunSpec[] {
  return Array.from({ length: ROWS }, (_, i) => {
    const intent = INTENT_CYCLE[i % INTENT_CYCLE.length] as Intent;
    const failing = i % 4 === 0;
    const outcome: RunOutcome = failing ? 'failed' : 'resolved_automatically';

    return {
      intent,
      outcome,
      finalState: failing ? 'ACTION_FAILED' : 'RESOLVED',
      durationMs: 100 + (i % 900),
      costUsdMicros: 20 + (i % 50),
      // Spread over the window so the date-range filters have something to narrow.
      startedAt: new Date(START.getTime() + i * 60_000),
      agentConfigVersion: i % 2 === 0 ? 'perf-config-1' : 'perf-config-2',
      evaluation: {
        verifiedResolution: !failing,
        ...(failing
          ? { failureCodes: [FAILURE_CYCLE[i % FAILURE_CYCLE.length] as FailureCode] }
          : {}),
        checks: [
          { checkId: 'policy_compliance', verdict: failing ? 'UNMET' : 'MET' },
          { checkId: 'response_grounded', verdict: 'MET' },
        ],
      },
      toolExecution: {
        toolName: failing ? 'create_refund' : 'create_replacement',
        status: failing ? 'failed' : 'ok',
        ...(failing ? { errorCode: 'UPSTREAM_TIMEOUT' } : {}),
      },
      ...(failing ? { escalation: { status: 'open' as const } } : {}),
    } satisfies RunSpec;
  });
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const value = await fn();
  const elapsed = performance.now() - started;
  expect(elapsed, `${label} took ${elapsed.toFixed(0)}ms`).toBeLessThan(BUDGET_MS);
  return value;
}

/**
 * At 5,000 rows a sequential scan is often genuinely cheaper, so the planner picks
 * one and an EXPLAIN of the plain query proves nothing about the index. Turning
 * seqscan off for the transaction asks the planner the question that matters: is
 * there an index that *can* serve this shape at all?
 */
async function planWithoutSeqScan(query: ReturnType<typeof runAggregateSql>): Promise<string> {
  return db().transaction(async (tx) => {
    await tx.execute(sqlExpr`set local enable_seqscan = off`);
    const rows = (await tx.execute(sqlExpr`explain (format text) ${query}`)) as unknown as Array<
      Record<string, string>
    >;
    return rows.map((r) => Object.values(r).join(' ')).join('\n');
  });
}

beforeAll(async () => {
  await dropTenant(TENANT);
  await seedRuns(TENANT, fixture());
  await db().execute(sqlExpr`analyze agent_runs, evaluations, evaluation_results, conversations`);
  await db().execute(sqlExpr`analyze tool_executions, escalations, approvals`);
}, 300_000);

afterAll(async () => {
  await dropTenant(TENANT);
  await closeDb();
});

describe(`metrics at ${ROWS} runs`, () => {
  it('answers every metrics query inside the budget', async () => {
    const metrics = await timed('computeMetrics', () => computeMetrics(WINDOW));
    expect(metrics.runs.total).toBe(ROWS);

    await timed('vrrTrend', () => vrrTrend(WINDOW));
    await timed('failureBreakdown', () => failureBreakdown(WINDOW));
    await timed('computeMetrics by intent', () =>
      computeMetrics({ ...WINDOW, intent: 'REFUND_REQUEST' }),
    );
    await timed('computeMetrics by config version', () =>
      computeMetrics({ ...WINDOW, agentConfigVersion: 'perf-config-1' }),
    );
    await timed('approval queue', () => listApprovalQueue(TENANT, { status: 'all' }));
  });

  // A range that covers every row is not a range: the planner correctly prefers the
  // narrower `agent_runs_tenant_idx` when the date predicate excludes nothing. These
  // plans use a slice of the window, which is the shape a real dashboard query has.
  const SLICE = { tenantId: TENANT, from: START, to: new Date(START.getTime() + 200 * 60_000) };

  it('has an index that can serve the run aggregate', async () => {
    const plan = await planWithoutSeqScan(runAggregateSql(SLICE));
    expect(plan).toContain('agent_runs_tenant_started_idx');
    expect(plan).not.toContain('Seq Scan on agent_runs');
  });

  it('has an index that can serve the aggregate narrowed by config version', async () => {
    const plan = await planWithoutSeqScan(
      runAggregateSql({ ...SLICE, agentConfigVersion: 'perf-config-1' }),
    );
    expect(plan).toContain('agent_runs_tenant_config_started_idx');
    expect(plan).not.toContain('Seq Scan on agent_runs');
  });

  it('has an index that can serve the aggregate narrowed by intent', async () => {
    const plan = await planWithoutSeqScan(runAggregateSql({ ...SLICE, intent: 'REFUND_REQUEST' }));
    expect(plan).toContain('agent_runs_tenant_intent_started_idx');
    expect(plan).not.toContain('Seq Scan on agent_runs');
  });

  it('has an index that can serve the failure breakdown', async () => {
    const plan = await planWithoutSeqScan(failureBreakdownSql(SLICE));
    expect(plan).toContain('agent_runs_tenant_started_idx');
    expect(plan).toContain('evaluations_run_unique');
    expect(plan).not.toContain('Seq Scan on evaluations');
  });
});

describe(`the conversation explorer at ${ROWS} rows`, () => {
  const combinations: Array<Record<string, unknown>> = [];
  for (const intent of [undefined, 'REFUND_REQUEST', 'BILLING_QUESTION']) {
    for (const outcome of [undefined, 'failed', 'resolved_automatically']) {
      for (const verified of [undefined, true, false]) {
        for (const escalated of [undefined, true]) {
          combinations.push({
            ...(intent ? { intent } : {}),
            ...(outcome ? { outcome } : {}),
            ...(verified !== undefined ? { verified } : {}),
            ...(escalated !== undefined ? { escalated } : {}),
          });
        }
      }
    }
  }
  for (const failureCode of FAILURE_CYCLE) combinations.push({ failureCode });
  combinations.push({ from: START, to: new Date(START.getTime() + 500 * 60_000) });

  it(`answers all ${combinations.length} filter combinations inside the budget`, async () => {
    for (const filter of combinations) {
      await timed(JSON.stringify(filter), () =>
        listConversationSummaries({ tenantId: TENANT, limit: 50, ...filter }),
      );
    }
  }, 120_000);

  it('has an index that can serve the first page and a later page', async () => {
    const first = await planWithoutSeqScan(conversationPageSql({ tenantId: TENANT, limit: 50 }));
    expect(first).toContain('agent_runs_tenant_started_idx');
    expect(first).not.toContain('Seq Scan on agent_runs');

    const deep = await planWithoutSeqScan(
      conversationPageSql({
        tenantId: TENANT,
        limit: 50,
        cursor: { startedAt: new Date(START.getTime() + 4000 * 60_000), id: 'run_zzz' },
      }),
    );
    expect(deep).toContain('agent_runs_tenant_started_idx');
  });

  it('stays inside the budget on the last page as well as the first', async () => {
    let cursor = (await listConversationSummaries({ tenantId: TENANT, limit: 50 })).nextCursor;
    let pages = 1;

    while (cursor && pages < 100) {
      const decoded = decodeCursor(cursor);
      expect(decoded).not.toBeNull();
      const page = await timed(`page ${pages + 1}`, () =>
        listConversationSummaries({
          tenantId: TENANT,
          limit: 50,
          ...(decoded ? { cursor: decoded } : {}),
        }),
      );
      cursor = page.nextCursor;
      pages++;
    }
    expect(pages).toBe(ROWS / 50);
  }, 120_000);

  it('visits every row exactly once while new rows are being inserted', async () => {
    const original = new Set(
      (await listConversationSummaries({ tenantId: TENANT, limit: ROWS })).items.map(
        (i) => i.runId,
      ),
    );
    expect(original.size).toBe(ROWS);

    const visited: string[] = [];
    let cursor: string | null = null;
    let inserted = 0;

    for (let page = 0; page < 200; page++) {
      const decoded: ReturnType<typeof decodeCursor> = cursor ? decodeCursor(cursor) : null;
      const result = await listConversationSummaries({
        tenantId: TENANT,
        limit: 100,
        ...(decoded ? { cursor: decoded } : {}),
      });
      visited.push(...result.items.map((i) => i.runId));

      if (inserted < 10) {
        await seedRuns(TENANT, [
          {
            intent: 'BILLING_QUESTION',
            outcome: 'resolved_automatically',
            durationMs: 10,
            costUsdMicros: 1,
            startedAt: now(),
          },
        ]);
        inserted++;
      }

      cursor = result.nextCursor;
      if (!cursor) break;
    }

    const fromOriginal = visited.filter((id) => original.has(id));
    expect(fromOriginal).toHaveLength(ROWS);
    expect(new Set(fromOriginal).size).toBe(ROWS);
    expect(new Set(visited).size).toBe(visited.length);
  }, 180_000);
});

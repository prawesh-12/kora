import { serverEnv } from '@kora/core';
import { closeDb, computeMetrics, failureBreakdown, vrrTrend } from '@kora/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type RunSpec, daysAgo, dropTenant, seedRuns } from './support/seed';

let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));
vi.mock('next/server', () => ({ after: () => {} }));

const { auth } = await import('@/lib/auth');
const { GET: getMetrics } = await import('@/app/api/metrics/route');
const { GET: getFailures } = await import('@/app/api/metrics/failures/route');

const TENANT = 'ten_metrics_test';
const START = daysAgo(1);
const WINDOW = { tenantId: TENANT, from: daysAgo(2), to: daysAgo(0) };

/**
 * 25 runs with known outcomes. Every expectation below is worked out from this
 * table by hand, so a metric that quietly changes definition fails here.
 *
 *   10 resolved + verified        eligible, evaluated, verified
 *    4 failed, tool timeout       eligible, evaluated, not verified
 *    3 escalated, policy denied   eligible, evaluated, not verified
 *    2 resolved, not yet judged   eligible, pending, never a failure
 *    5 HUMAN_REQUEST              coverage, excluded from the rate
 *    1 OUT_OF_SCOPE               coverage, excluded from the rate
 */
function fixture(): RunSpec[] {
  const specs: RunSpec[] = [];
  const at = (index: number) => new Date(START.getTime() + index * 1000);
  let duration = 0;
  const nextDuration = () => {
    duration += 100;
    return duration;
  };

  for (let i = 0; i < 10; i++) {
    specs.push({
      intent: 'DAMAGED_ORDER',
      outcome: 'resolved_automatically',
      durationMs: nextDuration(),
      costUsdMicros: 100,
      startedAt: at(specs.length),
      evaluation: {
        verifiedResolution: true,
        checks: [
          { checkId: 'policy_compliance', verdict: 'MET' },
          { checkId: 'response_grounded', verdict: 'MET' },
        ],
      },
      toolExecution: { toolName: 'create_replacement', status: 'ok' },
    });
  }

  for (let i = 0; i < 4; i++) {
    specs.push({
      intent: 'REFUND_REQUEST',
      outcome: 'failed',
      finalState: 'ACTION_FAILED',
      durationMs: nextDuration(),
      costUsdMicros: 100,
      startedAt: at(specs.length),
      evaluation: {
        verifiedResolution: false,
        failureCodes: ['TOOL_EXECUTION_FAILURE', 'OUTCOME_FAILURE'],
        checks: [{ checkId: 'response_grounded', verdict: 'UNMET' }],
      },
      toolExecution: {
        toolName: 'create_refund',
        status: 'failed',
        errorCode: 'UPSTREAM_TIMEOUT',
      },
    });
  }

  for (let i = 0; i < 3; i++) {
    specs.push({
      intent: 'CANCEL_ORDER',
      outcome: 'escalated',
      finalState: 'NEEDS_HUMAN',
      durationMs: nextDuration(),
      costUsdMicros: 100,
      startedAt: at(specs.length),
      evaluation: {
        verifiedResolution: false,
        failureCodes: ['POLICY_FAILURE'],
        checks: [{ checkId: 'policy_compliance', verdict: 'UNMET' }],
      },
      policyCheck: { ruleId: 'cancellation_window_closed', decision: 'deny' },
      escalation: { status: 'open' },
    });
  }

  for (let i = 0; i < 2; i++) {
    specs.push({
      intent: 'ORDER_STATUS',
      outcome: 'resolved_automatically',
      durationMs: nextDuration(),
      costUsdMicros: 100,
      startedAt: at(specs.length),
    });
  }

  for (let i = 0; i < 5; i++) {
    specs.push({
      intent: 'HUMAN_REQUEST',
      outcome: 'escalated',
      finalState: 'NEEDS_HUMAN',
      durationMs: nextDuration(),
      costUsdMicros: 999,
      startedAt: at(specs.length),
      evaluation: { verifiedResolution: false },
    });
  }

  specs.push({
    intent: 'OUT_OF_SCOPE',
    outcome: 'escalated',
    finalState: 'NEEDS_HUMAN',
    durationMs: nextDuration(),
    costUsdMicros: 999,
    startedAt: at(specs.length),
  });

  return specs;
}

async function signInAsOperator(): Promise<void> {
  const env = serverEnv();
  const res = await auth().api.signInEmail({
    body: { email: env.KORA_SEED_OPERATOR_EMAIL, password: env.KORA_SEED_OPERATOR_PASSWORD },
    asResponse: true,
  });
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c));
  requestHeaders = new Headers({ cookie: cookies.join('; ') });
}

beforeAll(async () => {
  const { seed } = await import('@kora/db');
  await seed();
  await dropTenant(TENANT);
  await seedRuns(TENANT, fixture());
});

afterAll(async () => {
  await dropTenant(TENANT);
  await closeDb();
});

describe('metric definitions', () => {
  it('matches a hand-computed expectation for every metric', async () => {
    const m = await computeMetrics(WINDOW);

    expect(m.runs).toEqual({ total: 25, eligible: 19, evaluated: 17, pending: 2 });
    expect(m.coverage).toEqual({
      inScope: 19,
      outOfScope: 1,
      humanRequest: 5,
      rate: 19 / 25,
    });

    expect(m.automationRate).toBeCloseTo(12 / 19, 10);
    expect(m.escalationRate).toBeCloseTo(3 / 19, 10);
    expect(m.verifiedResolutionRate).toBeCloseTo(10 / 17, 10);
    expect(m.verifiedResolutions).toBe(10);
    expect(m.policyComplianceRate).toBeCloseTo(10 / 13, 10);
    expect(m.groundingRate).toBeCloseTo(10 / 14, 10);
    expect(m.toolSuccessRate).toBeCloseTo(10 / 14, 10);

    // 25 distinct durations, 100ms to 2500ms.
    expect(m.latencyMs.p50).toBe(1300);
    expect(m.latencyMs.p95).toBeCloseTo(2380, 6);
  });

  it('divides cost by verified resolutions, not by conversations', async () => {
    const m = await computeMetrics(WINDOW);

    // 19 eligible runs at 100 micros each. The 6 coverage runs cost 999 each and
    // are excluded, so a spike in out-of-scope traffic cannot move this number.
    expect(m.totalCostUsdMicros).toBe(1900);
    expect(m.costPerResolutionUsdMicros).toBe(190);
    expect(m.costPerResolutionUsdMicros).not.toBe(Math.round(1900 / m.runs.total));
  });

  it('reports no data rather than 0% or NaN when nothing is eligible', async () => {
    const m = await computeMetrics({ tenantId: TENANT, from: daysAgo(400), to: daysAgo(399) });

    expect(m.runs.total).toBe(0);
    expect(m.verifiedResolutionRate).toBeNull();
    expect(m.automationRate).toBeNull();
    expect(m.escalationRate).toBeNull();
    expect(m.policyComplianceRate).toBeNull();
    expect(m.toolSuccessRate).toBeNull();
    expect(m.costPerResolutionUsdMicros).toBeNull();
    expect(m.latencyMs.p50).toBeNull();
    expect(Number.isNaN(m.coverage.rate ?? 0)).toBe(false);
  });

  it('narrows to one intent and one agent config version', async () => {
    const byIntent = await computeMetrics({ ...WINDOW, intent: 'DAMAGED_ORDER' });
    expect(byIntent.runs.total).toBe(10);
    expect(byIntent.verifiedResolutionRate).toBe(1);

    const byVersion = await computeMetrics({ ...WINDOW, agentConfigVersion: 'not-a-version' });
    expect(byVersion.runs.total).toBe(0);
  });

  it('puts every eligible run on the trend line with its own denominator', async () => {
    const trend = await vrrTrend(WINDOW);
    const total = trend.reduce((sum, point) => sum + point.runs, 0);

    expect(total).toBe(19);
    expect(trend.every((point) => point.evaluated <= point.runs)).toBe(true);
  });
});

describe('failure breakdown', () => {
  it('counts the primary code only and names the most common detail', async () => {
    const buckets = await failureBreakdown(WINDOW);
    const byCode = new Map(buckets.map((b) => [b.code, b]));

    expect(byCode.get('TOOL_EXECUTION_FAILURE')).toEqual({
      code: 'TOOL_EXECUTION_FAILURE',
      count: 4,
      topDetail: 'create_refund / upstream_timeout',
    });
    expect(byCode.get('POLICY_FAILURE')).toEqual({
      code: 'POLICY_FAILURE',
      count: 3,
      topDetail: 'cancellation_window_closed',
    });

    // OUTCOME_FAILURE is recorded on the same four runs, behind the root cause.
    // Counting it again would send an engineer to the symptom.
    expect(byCode.has('OUTCOME_FAILURE')).toBe(false);
  });

  it('gives the drill path a filter that reaches the failing runs', async () => {
    const { listConversationSummaries } = await import('@kora/db');
    const buckets = await failureBreakdown(WINDOW);
    const tallest = buckets[0];
    expect(tallest?.code).toBe('TOOL_EXECUTION_FAILURE');

    const page = await listConversationSummaries({
      tenantId: TENANT,
      limit: 50,
      failureCode: 'TOOL_EXECUTION_FAILURE',
    });
    expect(page.items).toHaveLength(4);
    expect(page.items.every((i) => i.primaryFailureCode === 'TOOL_EXECUTION_FAILURE')).toBe(true);
    expect(page.items.every((i) => i.runId.startsWith('run_'))).toBe(true);
  });
});

describe('the metrics routes', () => {
  it('refuses a range wider than 90 days rather than scanning the table', async () => {
    await signInAsOperator();

    const res = await getMetrics(
      new Request('http://localhost/api/metrics?from=2020-01-01&to=2024-01-01'),
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toContain('90 days');
  });

  it('serves the failure breakdown as code, count and detail', async () => {
    await signInAsOperator();

    const res = await getFailures(new Request('http://localhost/api/metrics/failures'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{ code: string; count: number; topDetail: string }>;
    expect(Array.isArray(body)).toBe(true);
    for (const bucket of body) {
      expect(typeof bucket.code).toBe('string');
      expect(typeof bucket.count).toBe('number');
      expect(typeof bucket.topDetail).toBe('string');
    }
  });

  it('rejects an unauthenticated request', async () => {
    requestHeaders = new Headers();
    const res = await getMetrics(new Request('http://localhost/api/metrics'));
    expect(res.status).toBe(401);
  });
});

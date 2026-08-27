import { ValidationError, newId } from '@kora/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, sql } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import { withTenant } from '../src/repositories/index.js';
import { assembleTrace } from '../src/tracing/assemble.js';
import { startRun } from '../src/tracing/handle.js';

const TENANT = 'ten_trace_test';

beforeAll(async () => {
  await runMigrations();
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Trace test')
              ON CONFLICT (id) DO NOTHING`;
});

afterAll(async () => {
  await sql()`DELETE FROM conversations WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeDb();
});

async function newRun() {
  const repos = withTenant(TENANT);
  const conv = await repos.conversations.create({ externalCustomerId: 'cus_014' });
  const run = await startRun({
    tenantId: TENANT,
    conversationId: conv.id,
    agentConfigVersion: 'test-config',
  });
  return { repos, conv, run };
}

describe('trace writer', () => {
  it('rebuilds a run with its steps, tools and totals', async () => {
    const { repos, run } = await newRun();

    await run.step('intent', { intent: 'DAMAGED_ORDER' }, async () => 'ok');
    await run.step('retrieval', { query: 'damaged item', chunks: [] }, async () => 'ok');
    const stepId = await run.record('policy', { decision: 'allow' });

    await repos.toolExecutions.create({
      runId: run.runId,
      stepId,
      toolName: 'get_order',
      toolVersion: 1,
      input: { orderId: '9832' },
      output: { id: '9832' },
      status: 'ok',
      durationMs: 12,
    });
    await repos.llmCalls.create({
      runId: run.runId,
      purpose: 'classifier',
      model: 'mock-classifier',
      provider: 'mock',
      inputTokens: 120,
      outputTokens: 30,
      costUsdMicros: 45,
      status: 'ok',
      latencyMs: 90,
    });

    await run.finish('resolved_automatically', 'RESOLVED');

    const trace = await assembleTrace(TENANT, run.runId);
    expect(trace.run.finalState).toBe('RESOLVED');
    expect(trace.run.outcome).toBe('resolved_automatically');
    expect(trace.toolExecutions).toHaveLength(1);
    expect(trace.retrievals).toHaveLength(1);
    expect(trace.totals).toMatchObject({ tokensIn: 120, tokensOut: 30, costUsdMicros: 45 });
    expect(trace.steps.map((s) => s.ordinal)).toEqual([0, 1, 2]);
    expect(trace.run.tokenInput).toBe(120);
  });

  it('gives 50 concurrent steps unique ordinals 0..49', async () => {
    const { run } = await newRun();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => run.step('model', { i }, async () => i)),
    );
    const steps = await withTenant(TENANT).steps.listForRun(run.runId);
    expect(steps.map((s) => s.ordinal)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('records a failed step and rethrows', async () => {
    const { run } = await newRun();
    await expect(
      run.step('tool', { tool: 'boom' }, async () => {
        throw new Error('upstream exploded');
      }),
    ).rejects.toThrow('upstream exploded');

    const steps = await withTenant(TENANT).steps.listForRun(run.runId);
    const failed = steps.find((s) => s.status === 'failed');
    expect(failed).toBeDefined();
    expect((failed!.payload as { error: string }).error).toBe('upstream exploded');
  });

  it('assembles a crashed run that never called finish', async () => {
    const { run } = await newRun();
    await run.step('model', {}, async () => 'ok');
    const trace = await assembleTrace(TENANT, run.runId);
    expect(trace.run.finishedAt).toBeNull();
    expect(trace.steps).toHaveLength(1);
    expect(trace.totals.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('ignores a second finish and leaves totals intact', async () => {
    const { run } = await newRun();
    await run.finish('resolved_automatically', 'RESOLVED');
    await run.finish('failed', 'NEEDS_HUMAN');
    const trace = await assembleTrace(TENANT, run.runId);
    expect(trace.run.outcome).toBe('resolved_automatically');
    expect(trace.run.finalState).toBe('RESOLVED');
  });

  it('reports an unknown run as not found', async () => {
    await expect(assembleTrace(TENANT, newId('run'))).rejects.toThrow(ValidationError);
  });

  it('hides another tenant run behind the same not-found error', async () => {
    const { run } = await newRun();
    await expect(assembleTrace('ten_someone_else', run.runId)).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
  });
});

describe('step durations', () => {
  it('records nothing rather than zero for a step with no span', async () => {
    const { run } = await newRun();
    await run.record('response', { text: 'done' });
    await run.setState('RESOLVED');

    const rows = await sql()<{ kind: string; duration_ms: number | null }[]>`
      SELECT kind, duration_ms FROM run_steps WHERE run_id = ${run.runId} ORDER BY ordinal`;

    // Zero is a claim that the step took no time, and it put `0ms` on every row
    // of the trace. A marker has no span, so it stores null.
    expect(rows.every((r) => r.duration_ms === null)).toBe(true);
  });

  it('records the real span when the caller measured one', async () => {
    const { run } = await newRun();
    await run.record('model', { intent: 'DAMAGED_ORDER' }, 'ok', 1234);

    const [row] = await sql()<{ duration_ms: number }[]>`
      SELECT duration_ms FROM run_steps WHERE run_id = ${run.runId} AND kind = 'model'`;
    expect(row?.duration_ms).toBe(1234);
  });

  it('measures a step that wraps work', async () => {
    const { run } = await newRun();
    await run.step('retrieval', { query: 'returns policy' }, async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    const [row] = await sql()<{ duration_ms: number }[]>`
      SELECT duration_ms FROM run_steps WHERE run_id = ${run.runId} AND kind = 'retrieval'`;
    expect(row?.duration_ms).toBeGreaterThanOrEqual(20);
  });
});

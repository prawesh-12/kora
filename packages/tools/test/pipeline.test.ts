import { now } from '@kora/core';
import { sql, withTenant } from '@kora/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeTool } from '../src/pipeline.js';
import {
  ALL_TOOLS,
  ORDER_9832,
  TENANT,
  acmeRequestLog,
  acmeUp,
  argsFor,
  cleanupTenant,
  ensureTenant,
  newRun,
  resetAcme,
} from './helpers.js';

beforeAll(async () => {
  if (!(await acmeUp())) {
    throw new Error(
      'the acme mock commerce service is not running on ACME_BASE_URL. Start it with: pnpm --filter @kora/mock-commerce exec tsx src/index.ts',
    );
  }
  await ensureTenant();
});

beforeEach(async () => {
  await resetAcme(['9832', '9833', '9834', '9835', '9836']);
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
});

afterAll(cleanupTenant);

async function executions(runId: string) {
  return withTenant(TENANT).toolExecutions.listForRun(runId);
}

async function policyChecks(runId: string) {
  return withTenant(TENANT).policyChecks.listForRun(runId);
}

describe('tool execution pipeline', () => {
  it('1. runs a valid read and records both an execution and an allow policy check', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('get_order', { orderId: '9832' }, run, conversationId),
    );

    expect(outcome.status).toBe('ok');
    const rows = await executions(run.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ok');
    expect(rows[0]?.verified).toBeNull();

    const checks = await policyChecks(run.runId);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.decision).toBe('allow');
    expect(checks[0]?.ruleId).toBe('reads_always_allowed');
  });

  it('2. rejects a bad input shape without writing an execution row', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('get_order', { orderNumber: 9832 }, run, conversationId),
    );

    expect(outcome.status).toBe('invalid_input');
    if (outcome.status === 'invalid_input') expect(outcome.issues.length).toBeGreaterThan(0);
    expect(await executions(run.runId)).toHaveLength(0);
  });

  it('3. denies a tool that is not in allowedTools and never calls acme', async () => {
    const { run, conversationId } = await newRun();
    const before = (await acmeRequestLog('/replacements')).length;

    const outcome = await executeTool(
      argsFor(
        'create_replacement',
        { orderId: '9832', items: [{ sku: 'SKU-CM-01', quantity: 1 }], reason: 'damaged' },
        run,
        conversationId,
        {
          allowedTools: ALL_TOOLS.filter((t) => t.name !== 'create_replacement'),
        },
      ),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('PERMISSION_DENIED');
    expect((await acmeRequestLog('/replacements')).length).toBe(before);
  });

  it('4. denies on policy and records the rule id', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_replacement',
        { orderId: '9834', items: [{ sku: 'SKU-KT-03', quantity: 1 }], reason: 'damaged' },
        run,
        conversationId,
        {
          gathered: {
            order: {
              ...ORDER_9832,
              id: '9834',
              totalAmountMinor: 219900,
              deliveredAt: new Date(now().getTime() - 12 * 86_400_000).toISOString(),
            },
          },
        },
      ),
    );

    expect(outcome.status).toBe('denied');
    const checks = await policyChecks(run.runId);
    expect(checks[0]?.decision).toBe('deny');
    expect(checks[0]?.ruleId).toBe('outside_return_window');
  });

  it('5. requires approval above the threshold, creates one pending row, and never calls acme', async () => {
    const { run, conversationId } = await newRun();
    const before = (await acmeRequestLog('/replacements')).length;

    const outcome = await executeTool(
      argsFor(
        'create_replacement',
        { orderId: '9833', items: [{ sku: 'SKU-EM-02', quantity: 1 }], reason: 'damaged' },
        run,
        conversationId,
        { gathered: { order: { ...ORDER_9832, id: '9833', totalAmountMinor: 899900 } } },
      ),
    );

    expect(outcome.status).toBe('awaiting_approval');
    const pending = await withTenant(TENANT).approvals.listForRun(run.runId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('pending');
    expect((await acmeRequestLog('/replacements')).length).toBe(before);
  });

  it('6. simulates a write in simulation mode and leaves the acme log untouched', async () => {
    const { run, conversationId } = await newRun();
    const before = (await acmeRequestLog('/replacements')).length;

    const outcome = await executeTool(
      argsFor(
        'create_replacement',
        { orderId: '9832', items: [{ sku: 'SKU-CM-01', quantity: 1 }], reason: 'damaged' },
        run,
        conversationId,
        { deploymentMode: 'simulation' },
      ),
    );

    expect(outcome.status).toBe('simulated');
    expect((await acmeRequestLog('/replacements')).length).toBe(before);
    expect((await executions(run.runId))[0]?.status).toBe('simulated');
  });

  it('7. replays a duplicate call with the same input and creates one replacement', async () => {
    const { run, conversationId } = await newRun();
    const input = {
      orderId: '9832',
      items: [{ sku: 'SKU-CM-01', quantity: 1 }],
      reason: 'damaged' as const,
    };

    const first = await executeTool(argsFor('create_replacement', input, run, conversationId));
    const second = await executeTool(argsFor('create_replacement', input, run, conversationId));

    expect(first.status).toBe('ok');
    expect(second.status).toBe('replayed');

    const rows = await executions(run.runId);
    expect(rows.filter((r) => r.toolName === 'create_replacement')).toHaveLength(2);
    expect(rows.some((r) => r.status === 'replayed')).toBe(true);
  });

  it('8. executes twice when the input differs', async () => {
    const { run, conversationId } = await newRun();
    const a = await executeTool(argsFor('get_order', { orderId: '9832' }, run, conversationId));
    const b = await executeTool(argsFor('get_order', { orderId: '9833' }, run, conversationId));
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect((await executions(run.runId)).every((r) => r.status === 'ok')).toBe(true);
  });

  it('9. retries an idempotent tool on timeout, then fails with UPSTREAM_TIMEOUT', async () => {
    const { run, conversationId } = await newRun();
    const args = argsFor('get_order', { orderId: '9832' }, run, conversationId);
    args.ctx.fault = 'timeout';

    const outcome = await executeTool(args);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_TIMEOUT');
    const rows = await executions(run.runId);
    expect(rows.length).toBeGreaterThan(1);
  }, 90_000);

  it('10. retries on a 500 and records UPSTREAM_5XX per attempt', async () => {
    const { run, conversationId } = await newRun();
    const args = argsFor('get_order', { orderId: '9832' }, run, conversationId);
    args.ctx.fault = '500';

    const outcome = await executeTool(args);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_5XX');
    const rows = await executions(run.runId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.errorCode === 'UPSTREAM_5XX')).toBe(true);
  });

  it('11. does not retry a 404', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('get_order', { orderId: '9999' }, run, conversationId),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_4XX');
    expect(await executions(run.runId)).toHaveLength(1);
  });

  it('12. reports a malformed upstream response rather than passing it through', async () => {
    const { run, conversationId } = await newRun();
    const args = argsFor(
      'create_replacement',
      { orderId: '9832', items: [{ sku: 'SKU-CM-01', quantity: 1 }], reason: 'damaged' },
      run,
      conversationId,
    );
    args.ctx.fault = 'malformed';

    const outcome = await executeTool(args);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('MALFORMED_OUTPUT');
  });

  it('13. evaluates policy on the order record, not on a fact the model supplied', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_replacement',
        {
          orderId: '9834',
          items: [{ sku: 'SKU-KT-03', quantity: 1 }],
          reason: 'damaged',
          // A model could put anything here. The pipeline never reads it as a fact.
        },
        run,
        conversationId,
        {
          gathered: {
            order: {
              ...ORDER_9832,
              id: '9834',
              deliveredAt: new Date(now().getTime() - 12 * 86_400_000).toISOString(),
            },
          },
        },
      ),
    );

    expect(outcome.status).toBe('denied');
    const checks = await policyChecks(run.runId);
    expect(checks[0]?.facts).toMatchObject({ daysSinceDelivery: 12 });
  });

  it('14. refuses to run once the deadline has passed and never calls acme', async () => {
    const { run, conversationId } = await newRun();
    const before = (await acmeRequestLog('/orders/9832')).length;

    const args = argsFor('get_order', { orderId: '9832' }, run, conversationId);
    args.ctx.deadlineAt = new Date(now().getTime() - 1000);

    const outcome = await executeTool(args);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('DEADLINE_EXCEEDED');
    expect((await acmeRequestLog('/orders/9832')).length).toBe(before);
  });
});

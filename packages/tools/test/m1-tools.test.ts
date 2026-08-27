import { now } from '@kora/core';
import { sql, withTenant } from '@kora/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeTool } from '../src/pipeline.js';
import { registry } from '../src/tools/index.js';
import {
  ORDER_9832,
  TENANT,
  acmeUp,
  argsFor,
  cleanupTenant,
  ensureTenant,
  newRun,
  resetAcme,
} from './helpers.js';

const TOUCHED = ['9832', '9837', '9838', '9839', '9840', '9841'];

const deliveredOrder = {
  ...ORDER_9832,
  id: '9840',
  totalAmountMinor: 549900,
  deliveredAt: new Date(now().getTime() - 3 * 86_400_000).toISOString(),
};

const placedOrder = {
  ...ORDER_9832,
  id: '9837',
  status: 'placed',
  totalAmountMinor: 249900,
  deliveredAt: null,
};

beforeAll(async () => {
  if (!(await acmeUp())) throw new Error('acme mock commerce is not running');
  await ensureTenant();
});

beforeEach(async () => {
  await resetAcme(TOUCHED);
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
});

afterAll(cleanupTenant);

describe('the pipeline is generic across the new tools', () => {
  it('registers nine tools, each with an input example that parses', () => {
    expect(registry.list()).toHaveLength(9);
    for (const tool of registry.list()) {
      expect(() => tool.inputSchema.parse(tool.inputExamples?.[0]?.input)).not.toThrow();
    }
  });

  it('creates and verifies a refund', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_refund',
        { orderId: '9840', amountMinor: 200000, reason: 'damaged' },
        run,
        conversationId,
        { gathered: { order: deliveredOrder, refundedAmountMinor: 0 } },
      ),
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.verified).toBe(true);

    const rows = await withTenant(TENANT).toolExecutions.listForRun(run.runId);
    expect(rows[0]?.verified).toBe(true);
    expect((rows[0]!.output as { amountMinor: number }).amountMinor).toBe(200000);
  });

  it('cancels an order that has not shipped, and verifies the order really changed', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'cancel_order',
        { orderId: '9837', reason: 'customer_request' },
        run,
        conversationId,
        { gathered: { order: placedOrder } },
      ),
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.verified).toBe(true);

    const rows = await withTenant(TENANT).toolExecutions.listForRun(run.runId);
    const observed = rows[0]?.verifyObserved as { order: { status: string } };
    expect(observed.order.status).toBe('cancelled');
  });

  it('creates and verifies a ticket', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_ticket',
        {
          customerId: 'cus_014',
          orderId: '9832',
          subject: 'Could not confirm the replacement',
          body: 'The read-back did not show it.',
          priority: 'high',
        },
        run,
        conversationId,
      ),
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.verified).toBe(true);
  });
});

describe('input validation happens before any HTTP call', () => {
  it('rejects a zero or negative refund amount', async () => {
    const { run, conversationId } = await newRun();
    for (const amountMinor of [0, -100]) {
      const outcome = await executeTool(
        argsFor(
          'create_refund',
          { orderId: '9840', amountMinor, reason: 'damaged' },
          run,
          conversationId,
          {
            gathered: { order: deliveredOrder },
          },
        ),
      );
      expect(outcome.status).toBe('invalid_input');
    }
    expect(await withTenant(TENANT).toolExecutions.listForRun(run.runId)).toHaveLength(0);
  });

  it('rejects a non-integer refund amount', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_refund',
        { orderId: '9840', amountMinor: 100.5, reason: 'damaged' },
        run,
        conversationId,
        {
          gathered: { order: deliveredOrder },
        },
      ),
    );
    expect(outcome.status).toBe('invalid_input');
  });
});

describe('policy gates the new writes', () => {
  it('denies a refund above what is left on the order', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_refund',
        { orderId: '9840', amountMinor: 900000, reason: 'damaged' },
        run,
        conversationId,
        { gathered: { order: deliveredOrder, refundedAmountMinor: 0 } },
      ),
    );

    expect(outcome.status).toBe('denied');
    const checks = await withTenant(TENANT).policyChecks.listForRun(run.runId);
    expect(checks[0]?.ruleId).toBe('refund_exceeds_remaining');
  });

  it('denies a refund on an order that already had one in full', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_refund',
        { orderId: '9841', amountMinor: 1000, reason: 'damaged' },
        run,
        conversationId,
        {
          gathered: {
            order: { ...deliveredOrder, id: '9841', totalAmountMinor: 899900 },
            refundedAmountMinor: 899900,
          },
        },
      ),
    );

    expect(outcome.status).toBe('denied');
    const checks = await withTenant(TENANT).policyChecks.listForRun(run.runId);
    expect(checks[0]?.ruleId).toBe('refund_already_refunded');
  });

  it('denies cancelling a shipped order', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'cancel_order',
        { orderId: '9839', reason: 'customer_request' },
        run,
        conversationId,
        {
          gathered: { order: { ...placedOrder, id: '9839', status: 'shipped' } },
        },
      ),
    );

    expect(outcome.status).toBe('denied');
    const checks = await withTenant(TENANT).policyChecks.listForRun(run.runId);
    expect(checks[0]?.ruleId).toBe('cancel_after_shipment');
  });

  it('requires approval for a high value cancellation', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'cancel_order',
        { orderId: '9838', reason: 'customer_request' },
        run,
        conversationId,
        {
          gathered: {
            order: { ...placedOrder, id: '9838', status: 'confirmed', totalAmountMinor: 1299900 },
          },
        },
      ),
    );

    expect(outcome.status).toBe('awaiting_approval');
  });
});

describe('verification catches a write that did not land', () => {
  const cases: Array<[string, unknown, string, Record<string, unknown>]> = [
    [
      'create_refund',
      { orderId: '9840', amountMinor: 200000, reason: 'damaged' },
      'refund_not_found',
      { order: deliveredOrder, refundedAmountMinor: 0 },
    ],
    [
      'cancel_order',
      { orderId: '9837', reason: 'customer_request' },
      'order_still_placed',
      { order: placedOrder },
    ],
    [
      'create_ticket',
      {
        customerId: 'cus_014',
        subject: 'x',
        body: 'y',
        priority: 'normal',
      },
      'ticket_not_found',
      {},
    ],
  ];

  for (const [tool, input, reason, gathered] of cases) {
    it(`${tool} reports ${reason} under the stale fault`, async () => {
      const { run, conversationId } = await newRun();
      const args = argsFor(tool, input, run, conversationId, { gathered: gathered as never });
      args.ctx.fault = 'stale';

      const outcome = await executeTool(args);
      expect(outcome.status).toBe('ok');
      if (outcome.status === 'ok') expect(outcome.verified).toBe(false);

      const rows = await withTenant(TENANT).toolExecutions.listForRun(run.runId);
      expect(rows[0]?.errorMessage).toBe(reason);
      expect(rows[0]?.errorCode).toBe('VERIFY_FAILED');
    });
  }
});

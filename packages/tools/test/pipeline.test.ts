import { now } from '@kora/core';
import { sql, withTenant } from '@kora/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setTenantStripeKey } from '../src/billing/tenant-keys.js';
import { executeTool } from '../src/pipeline.js';
import {
  ALL_TOOLS,
  CHARGE,
  OLD_CHARGE,
  SUBSCRIPTION,
  TENANT,
  argsFor,
  cleanupTenant,
  ensureTenant,
  installFakeBilling,
  newRun,
  resetBilling,
  resetRunState,
} from './helpers.js';
import type { FakeBillingProvider } from './fake-billing.js';

const REFUND = {
  subscriptionId: SUBSCRIPTION.id,
  invoiceId: 'in_1S',
  amountMinor: 200_000,
  reason: 'requested_by_customer' as const,
};

let billing: FakeBillingProvider;

beforeAll(ensureTenant);

beforeEach(async () => {
  billing = installFakeBilling();
  await resetRunState();
});

afterEach(resetBilling);

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
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId),
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
      argsFor('get_subscription', { subscription: 1 }, run, conversationId),
    );

    expect(outcome.status).toBe('invalid_input');
    if (outcome.status === 'invalid_input') expect(outcome.issues.length).toBeGreaterThan(0);
    expect(await executions(run.runId)).toHaveLength(0);
  });

  it('3. denies a tool that is not in allowedTools and never calls the billing provider', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('create_refund', REFUND, run, conversationId, {
        allowedTools: ALL_TOOLS.filter((t) => t.name !== 'create_refund'),
      }),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('PERMISSION_DENIED');
    expect(billing.calls).toHaveLength(0);
  });

  it('4. denies on policy and records the rule id', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_refund',
        { ...REFUND, invoiceId: 'in_3S' },
        run,
        conversationId,
        { gathered: { subscription: SUBSCRIPTION, charge: OLD_CHARGE } },
      ),
    );

    expect(outcome.status).toBe('denied');
    const checks = await policyChecks(run.runId);
    expect(checks[0]?.decision).toBe('deny');
    expect(checks[0]?.ruleId).toBe('refund_outside_window');
    expect(billing.calls).toHaveLength(0);
  });

  it('5. requires approval above the threshold, creates one pending row, and never calls the provider', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor(
        'create_refund',
        { ...REFUND, amountMinor: 600_000 },
        run,
        conversationId,
        { gathered: { subscription: SUBSCRIPTION, charge: { ...CHARGE, remainingRefundable: { amountMinor: 1_200_000, currency: 'INR' } } } },
      ),
    );

    expect(outcome.status).toBe('awaiting_approval');
    const pending = await withTenant(TENANT).approvals.listForRun(run.runId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('pending');
    expect(billing.calls).toHaveLength(0);
  });

  it('6. simulates a write in simulation mode and sends nothing to the provider', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('create_refund', REFUND, run, conversationId, { deploymentMode: 'simulation' }),
    );

    expect(outcome.status).toBe('simulated');
    expect(billing.calls).toHaveLength(0);
    expect((await executions(run.runId))[0]?.status).toBe('simulated');
  });

  it('7. replays a duplicate call with the same input and creates one refund', async () => {
    const { run, conversationId } = await newRun();

    const first = await executeTool(argsFor('create_refund', REFUND, run, conversationId));
    const second = await executeTool(argsFor('create_refund', REFUND, run, conversationId));

    expect(first.status).toBe('ok');
    expect(second.status).toBe('replayed');
    expect(billing.createdRefunds).toHaveLength(1);

    const rows = await executions(run.runId);
    expect(rows.filter((r) => r.toolName === 'create_refund')).toHaveLength(2);
    expect(rows.some((r) => r.status === 'replayed')).toBe(true);
  });

  it('8. executes twice when the input differs', async () => {
    const { run, conversationId } = await newRun();
    const a = await executeTool(
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId),
    );
    const b = await executeTool(
      argsFor('get_subscription', { subscriptionId: 'sub_2S' }, run, conversationId),
    );
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect((await executions(run.runId)).every((r) => r.status === 'ok')).toBe(true);
  });

  it('9. retries an idempotent tool on timeout, then fails with UPSTREAM_TIMEOUT', async () => {
    const { run, conversationId } = await newRun();
    billing.fault = 'timeout';
    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_TIMEOUT');
    const rows = await executions(run.runId);
    expect(rows.length).toBeGreaterThan(1);
  }, 90_000);

  it('10. retries on a 500 and records UPSTREAM_5XX per attempt', async () => {
    const { run, conversationId } = await newRun();
    billing.fault = '500';
    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_5XX');
    const rows = await executions(run.runId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.errorCode === 'UPSTREAM_5XX')).toBe(true);
  });

  it('11. does not retry a 404', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: 'sub_missing' }, run, conversationId),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_4XX');
    expect(await executions(run.runId)).toHaveLength(1);
  });

  it('12. reports a malformed upstream response rather than passing it through', async () => {
    const { run, conversationId } = await newRun();
    billing.fault = 'malformed';

    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId),
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('MALFORMED_OUTPUT');
  });

  it('13. fails closed when no billing provider is wired in', async () => {
    resetBilling();
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(argsFor('create_refund', REFUND, run, conversationId));

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.code).toBe('CONFIG_ERROR');
      expect(outcome.retryable).toBe(false);
    }
  });

  it('14. evaluates policy on the charge record, not on a fact the model supplied', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor(
        'create_refund',
        // A model could claim anything about the charge. The pipeline never reads
        // the input as a fact: the days come from the charge record.
        { ...REFUND, invoiceId: 'in_3S', daysSinceCharge: 1 },
        run,
        conversationId,
        { gathered: { subscription: SUBSCRIPTION, charge: OLD_CHARGE } },
      ),
    );

    expect(outcome.status).toBe('denied');
    const checks = await policyChecks(run.runId);
    expect(checks[0]?.facts).toMatchObject({ daysSinceCharge: 45 });
  });

  it('15. refuses to run once the deadline has passed and never calls the provider', async () => {
    const { run, conversationId } = await newRun();

    const args = argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId);
    args.ctx.deadlineAt = new Date(now().getTime() - 1000);

    const outcome = await executeTool(args);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.code).toBe('DEADLINE_EXCEEDED');
    expect(billing.calls).toHaveLength(0);
  });

  it('16. fails a money write closed and escalates when the tenant has no Stripe key', async () => {
    await sql()`UPDATE tenant_settings SET stripe_secret_encrypted = NULL WHERE tenant_id = ${TENANT}`;
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(argsFor('create_refund', REFUND, run, conversationId));

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.code).toBe('CONFIG_ERROR');
      expect(outcome.retryable).toBe(false);
    }
    // A configuration fault never reaches Stripe and never claims an idempotency key.
    expect(billing.calls).toHaveLength(0);
    expect(await withTenant(TENANT).escalations.forRun(run.runId)).not.toBeNull();

    await setTenantStripeKey(TENANT, 'sk_test_pipeline');
  });
});

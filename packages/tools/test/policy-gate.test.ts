import { compilePolicyBundle, logger, now } from '@kora/core';
import { type RunHandle, closeDb, sql, startRun, withTenant } from '@kora/db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeTool } from '../src/pipeline.js';
import { checkPolicy } from '../src/tools/check-policy.js';
import { registry } from '../src/tools/index.js';
import type { GatheredContext, ToolContext } from '../src/types.js';

const TENANT = 'ten_policy_gate_test';

const bundle = compilePolicyBundle(
  ['refunds', 'cancellations', 'plan-changes'].map((name) => ({
    key: name,
    yaml: readFileSync(join(import.meta.dirname, `../../../config/policies/${name}.yaml`), 'utf8'),
  })),
);

const AT = now();
const AT_S = Math.floor(AT.getTime() / 1000);
const DAY_S = 86_400;

const subscription = {
  id: 'sub_1S',
  status: 'active' as const,
  customerId: 'cus_014',
  items: [
    {
      subscriptionItemId: 'si_1S',
      priceId: 'price_A',
      productId: 'prod_A',
      unitAmount: { amountMinor: 349900, currency: 'INR' },
      quantity: 1,
    },
  ],
  currentPeriodEnd: AT_S + 26 * DAY_S,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  cancelAt: null,
  latestInvoiceId: 'in_1S',
  collectionMethod: 'charge_automatically',
};

const charge = {
  id: 'ch_1S',
  amountCaptured: { amountMinor: 349900, currency: 'INR' },
  amountRefunded: { amountMinor: 100000, currency: 'INR' },
  remainingRefundable: { amountMinor: 249900, currency: 'INR' },
  currency: 'INR',
  paymentIntentId: 'pi_1S',
  invoiceId: 'in_1S',
  customerId: 'cus_014',
  created: AT_S - 5 * DAY_S,
  refunded: false,
};

const gathered: GatheredContext = { subscription, charge };

function evaluatorCtx(run: RunHandle, conversationId: string): ToolContext {
  return {
    tenantId: TENANT,
    conversationId,
    runId: run.runId,
    traceId: run.traceId,
    agentConfigVersion: 'test-config',
    actorId: 'agent',
    idempotencyKey: 'test-key',
    signal: AbortSignal.timeout(30_000),
    deadlineAt: new Date(now().getTime() + 30_000),
    logger: logger().child({ test: true }),
    policy: bundle,
    gathered,
  };
}

async function newRun(): Promise<{ run: RunHandle; conversationId: string }> {
  const conv = await withTenant(TENANT).conversations.create({ externalCustomerId: 'cus_014' });
  const run = await startRun({
    tenantId: TENANT,
    conversationId: conv.id,
    agentConfigVersion: 'test-config',
  });
  return { run, conversationId: conv.id };
}

beforeAll(async () => {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Policy gate test')
              ON CONFLICT (id) DO NOTHING`;
});

afterAll(async () => {
  await sql()`DELETE FROM conversations WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeDb();
});

describe('tool gate and evaluator share one decision function', () => {
  it('returns identical deny decisions for identical facts', async () => {
    const { run, conversationId } = await newRun();

    const evaluated = await checkPolicy.execute(
      { action: 'create_refund', amountMinor: 300000 },
      evaluatorCtx(run, conversationId),
    );

    const outcome = await executeTool({
      tool: registry.get('create_refund', 1),
      rawInput: {
        subscriptionId: 'sub_1S',
        amountMinor: 300000,
        reason: 'requested_by_customer',
      },
      ctx: {
        tenantId: TENANT,
        conversationId,
        runId: run.runId,
        traceId: run.traceId,
        agentConfigVersion: 'test-config',
        actorId: 'agent',
        deadlineAt: new Date(now().getTime() + 30_000),
        logger: logger().child({ test: true }),
      },
      policy: bundle,
      deploymentMode: 'full',
      allowedTools: registry.list().map((t) => ({ name: t.name, version: t.version })),
      grantedPermissions: registry.list().map((t) => t.requiredPermission),
      gathered,
      run,
    });

    expect(evaluated.decision).toBe('deny');
    expect(evaluated.ruleId).toBe('refund_exceeds_refundable');
    expect(outcome.status).toBe('denied');
    if (outcome.status !== 'denied') throw new Error('expected the gate to deny');
    expect(outcome.code).toBe('POLICY_DENIED');
    expect(outcome.reason).toBe(evaluated.reason);

    const checks = await withTenant(TENANT).policyChecks.listForRun(run.runId);
    expect(checks).toHaveLength(2);
    const advisory = checks.find((c) => c.advisory)!;
    const gating = checks.find((c) => !c.advisory)!;
    expect(advisory.decision).toBe(gating.decision);
    expect(advisory.ruleId).toBe(gating.ruleId);
    expect(advisory.ruleId).toBe('refund_exceeds_refundable');
    expect(advisory.facts).toEqual(gating.facts);
    expect(gating.facts).toEqual({
      action: 'create_refund',
      exceedsRefundable: true,
    });
    expect(outcome.policyCheckId).toBe(gating.id);
    expect(gating.policyKey).toBe('refunds');
    expect(gating.policyVersion).toBe('1.0.0');
  });

  it('writes a policy_checks row on allow too, recording the facts used', async () => {
    const { run, conversationId } = await newRun();

    const evaluated = await checkPolicy.execute(
      { action: 'create_refund', amountMinor: 200000 },
      evaluatorCtx(run, conversationId),
    );
    expect(evaluated.decision).toBe('allow');
    expect(evaluated.ruleId).toBe('refund_standard');

    const checks = await withTenant(TENANT).policyChecks.listForRun(run.runId);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.decision).toBe('allow');
    expect(checks[0]?.advisory).toBe(true);
    expect(checks[0]?.facts).toMatchObject({ action: 'create_refund', daysSinceCharge: 5 });
    expect(checks[0]?.missingFacts).toEqual([]);
  });

  it('falls to require_approval when the amount fact is missing', async () => {
    const { run, conversationId } = await newRun();
    const ctx = evaluatorCtx(run, conversationId);
    ctx.gathered = { subscription };

    const evaluated = await checkPolicy.execute({ action: 'create_refund' }, ctx);
    expect(evaluated.decision).toBe('require_approval');
    expect(evaluated.ruleId).toBe('default');
    expect(evaluated.missingFacts).toContain('amountMinor');

    const checks = await withTenant(TENANT).policyChecks.listForRun(run.runId);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.decision).toBe('require_approval');
  });
});

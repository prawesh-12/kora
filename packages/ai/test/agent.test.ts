import { assembleTrace, closeDb, sql, withTenant } from '@kora/db';
import {
  activate,
  activePolicyVersionIds,
  createDraft,
  ensureAgent,
  publishPolicy,
} from '@kora/db';
import { serverEnv } from '@kora/core';
import type {
  BillingProvider,
  CancelInput,
  ChargeRecord,
  InvoiceRecord,
  PlanChangeInput,
  RefundInput,
  RefundRecord,
  SubscriptionRecord,
} from '@kora/tools';
import { setBillingProvider } from '@kora/tools';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAgentTurn } from '../src/agent.js';
import { loadAgentConfig } from '../src/config.js';
import { INTENT_SYSTEM_PROMPT } from '../src/prompts/intent.js';
import { SYSTEM_POLICY } from '../src/prompts/system.js';
import { ingestDirectory } from '../src/knowledge/ingest.js';

const TENANT = 'ten_agent_test';
const KNOWLEDGE_DIR = join(import.meta.dirname, '../../../config/knowledge');
const REPO_ROOT = join(import.meta.dirname, '../../..');

async function publishMoneyOpsVersion(): Promise<void> {
  const env = serverEnv();
  const config = loadAgentConfig();
  const keys: string[] = [];
  for (const file of config.policyBundle) {
    const yaml = readFileSync(join(REPO_ROOT, file), 'utf8');
    const published = await publishPolicy(TENANT, basename(file, '.yaml'), yaml);
    keys.push(published.key);
  }
  const policyVersionIds = await activePolicyVersionIds(TENANT, keys);
  const agentId = await ensureAgent(TENANT, 'support', 'Kora Support');
  const draft = await createDraft(TENANT, agentId, {
    model: env.KORA_MODEL_AGENT,
    systemPrompt: SYSTEM_POLICY,
    intentPrompt: INTENT_SYSTEM_PROMPT,
    allowedTools: config.allowedTools,
    permissions: config.permissions,
    policyBundle: policyVersionIds,
    rubricVersion: env.KORA_RUBRIC_VERSION,
    maxSteps: config.maxSteps,
    runDeadlineMs: config.runDeadlineMs,
    confidenceThreshold: config.confidenceThreshold,
  });
  await activate(TENANT, draft.id, 'system');
}

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);
const inr = (amountMinor: number) => ({ amountMinor, currency: 'INR' });

function subscription(id: string, invoiceId: string): SubscriptionRecord {
  return {
    id,
    status: 'active',
    customerId: 'cus_test',
    items: [
      {
        subscriptionItemId: `si_${id}`,
        priceId: 'price_basic',
        productId: 'prod_basic',
        unitAmount: inr(349900),
        quantity: 1,
      },
    ],
    currentPeriodEnd: nowSec() + 30 * DAY,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelAt: null,
    latestInvoiceId: invoiceId,
    collectionMethod: 'charge_automatically',
  };
}

function invoice(id: string, subscriptionId: string, amountMinor: number): InvoiceRecord {
  return {
    id,
    status: 'paid',
    customerId: 'cus_test',
    subscriptionId,
    amountDue: inr(amountMinor),
    amountPaid: inr(amountMinor),
    amountRemaining: inr(0),
    paymentIntentId: `pi_${id}`,
    chargeId: `ch_${id}`,
    created: nowSec(),
  };
}

function charge(id: string, invoiceId: string, amountMinor: number, ageDays: number): ChargeRecord {
  return {
    id,
    amountCaptured: inr(amountMinor),
    amountRefunded: inr(0),
    remainingRefundable: inr(amountMinor),
    currency: 'INR',
    paymentIntentId: `pi_${invoiceId}`,
    invoiceId,
    customerId: 'cus_test',
    created: nowSec() - ageDays * DAY,
    refunded: false,
  };
}

function stubProvider(): BillingProvider {
  const subs = new Map<string, SubscriptionRecord>([
    ['sub_recent', subscription('sub_recent', 'in_recent')],
    ['sub_old', subscription('sub_old', 'in_old')],
    ['sub_high', subscription('sub_high', 'in_high')],
    ['sub_cancel', subscription('sub_cancel', 'in_cancel')],
  ]);
  const invoices = new Map<string, InvoiceRecord>([
    ['in_recent', invoice('in_recent', 'sub_recent', 349900)],
    ['in_old', invoice('in_old', 'sub_old', 349900)],
    ['in_high', invoice('in_high', 'sub_high', 899900)],
    ['in_cancel', invoice('in_cancel', 'sub_cancel', 349900)],
  ]);
  const charges = new Map<string, ChargeRecord>([
    ['in_recent', charge('ch_recent', 'in_recent', 349900, 5)],
    ['in_old', charge('ch_old', 'in_old', 349900, 45)],
    ['in_high', charge('ch_high', 'in_high', 899900, 5)],
    ['in_cancel', charge('ch_cancel', 'in_cancel', 349900, 5)],
  ]);
  const refunds = new Map<string, RefundRecord>();
  const byKey = new Map<string, RefundRecord>();
  let n = 0;

  return {
    getCustomer: async (id) => ({
      id,
      email: 'customer@example.com',
      name: 'Test Customer',
      defaultPaymentMethodId: null,
      currency: 'INR',
    }),
    getSubscription: async (id) => {
      const sub = subs.get(id);
      if (!sub)
        throw Object.assign(new Error(`no such subscription ${id}`), { code: 'UPSTREAM_4XX' });
      return { ...sub };
    },
    getInvoice: async (id) => {
      const inv = invoices.get(id);
      if (!inv) throw Object.assign(new Error(`no such invoice ${id}`), { code: 'UPSTREAM_4XX' });
      return { ...inv };
    },
    resolveChargeForInvoice: async (invoiceId) => {
      const ch = charges.get(invoiceId);
      return ch ? { ...ch } : null;
    },
    previewChange: async () => ({
      lines: [],
      prorationCreditMinor: 0,
      nextChargeMinor: 0,
      currency: 'INR',
    }),
    createRefund: async (input: RefundInput, key: string) => {
      const existing = byKey.get(key);
      if (existing) return { ...existing };
      n += 1;
      const record: RefundRecord = {
        id: `re_test_${n}`,
        status: 'succeeded',
        amount: inr(input.amountMinor),
        chargeId: input.chargeId ?? null,
        paymentIntentId: null,
        reason: input.reason,
        created: nowSec(),
      };
      refunds.set(record.id, record);
      byKey.set(key, record);
      return { ...record };
    },
    cancelSubscription: async (input: CancelInput) => {
      const sub = subs.get(input.subscriptionId);
      if (!sub) throw Object.assign(new Error('no such subscription'), { code: 'UPSTREAM_4XX' });
      const next: SubscriptionRecord =
        input.mode === 'immediate'
          ? { ...sub, status: 'canceled', canceledAt: nowSec() }
          : { ...sub, cancelAtPeriodEnd: true, cancelAt: sub.currentPeriodEnd };
      subs.set(input.subscriptionId, next);
      return { ...next };
    },
    changePlan: async (input: PlanChangeInput) => {
      const sub = subs.get(input.subscriptionId);
      if (!sub) throw Object.assign(new Error('no such subscription'), { code: 'UPSTREAM_4XX' });
      const next: SubscriptionRecord = {
        ...sub,
        items: sub.items.map((item) =>
          item.subscriptionItemId === input.subscriptionItemId
            ? { ...item, priceId: input.targetPriceId }
            : item,
        ),
      };
      subs.set(input.subscriptionId, next);
      return { ...next };
    },
    getRefund: async (id) => {
      const record = refunds.get(id);
      if (!record) throw Object.assign(new Error(`no such refund ${id}`), { code: 'UPSTREAM_4XX' });
      return { ...record };
    },
  };
}

async function newConversation() {
  const conv = await withTenant(TENANT).conversations.create({ externalCustomerId: 'cus_test' });
  return conv.id;
}

async function turn(message: string, deploymentMode: 'full' | 'human_approval' = 'full') {
  return runAgentTurn({
    tenantId: TENANT,
    conversationId: await newConversation(),
    message,
    deploymentMode,
  });
}

beforeAll(async () => {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Agent test')
              ON CONFLICT (id) DO NOTHING`;
  await publishMoneyOpsVersion();
  await ingestDirectory({ tenantId: TENANT, dir: KNOWLEDGE_DIR });
});

beforeEach(async () => {
  setBillingProvider(stubProvider());
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
  await sql()`UPDATE documents SET status = 'active' WHERE tenant_id = ${TENANT}`;
});

afterAll(async () => {
  setBillingProvider(null);
  await sql()`DELETE FROM conversations WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM document_chunks WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM documents WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM llm_calls WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeDb();
});

describe('S1 refund within window', () => {
  it('resolves and creates exactly one verified refund', async () => {
    const result = await turn('Please refund my last payment for sub_recent.');

    expect(result.intent).toBe('REFUND_REQUEST');
    expect(result.finalState).toBe('RESOLVED');
    expect(result.outcome).toBe('resolved_automatically');
    expect(result.toolsCalled).toEqual(
      expect.arrayContaining([
        'get_subscription',
        'get_invoice',
        'search_knowledge',
        'check_policy',
        'create_refund',
      ]),
    );
    expect(result.toolsCalled).not.toContain('escalate_to_human');
    expect(result.text).toMatch(/re_test_\d+/);
    expect(result.text).toContain('3,499');
  });

  it('leaves a trace that rebuilds from the database alone', async () => {
    const result = await turn('Please refund my last payment for sub_recent.');
    const trace = await assembleTrace(TENANT, result.runId);

    expect(trace.run.intent).toBe('REFUND_REQUEST');
    expect(trace.run.finalState).toBe('RESOLVED');
    expect(trace.retrievals.length).toBeGreaterThan(0);

    const created = trace.toolExecutions.filter(
      (e) => e.toolName === 'create_refund' && e.status === 'ok',
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.verified).toBe(true);
    expect(created[0]?.verifyObserved).not.toBeNull();

    const allowed = trace.policyChecks.find((c) => c.action === 'create_refund');
    expect(allowed?.decision).toBe('allow');
    expect(allowed?.ruleId).toBe('refund_standard');

    expect(result.text).toContain((created[0]!.output as { refundId: string }).refundId);
  });
});

describe('S2 refund outside the window', () => {
  it('is denied by policy and writes nothing', async () => {
    const result = await turn('Please refund my last payment for sub_old.');

    expect(result.finalState).toBe('RESOLVED');
    expect(result.toolsCalled).not.toContain('create_refund');
    expect(result.text).toContain('30 days');

    const checks = await withTenant(TENANT).policyChecks.listForRun(result.runId);
    expect(checks.find((c) => c.action === 'create_refund')?.ruleId).toBe('refund_outside_window');
  });
});

describe('S4 high-value refund', () => {
  it('stops at a pending approval and writes nothing', async () => {
    const result = await turn('Please refund it all for sub_high.', 'human_approval');

    expect(result.approvalId).not.toBeNull();
    expect(result.finalState).toBe('AWAITING_APPROVAL');

    const checks = await withTenant(TENANT).policyChecks.listForRun(result.runId);
    const decision = checks.find((c) => c.action === 'create_refund');
    expect(decision?.decision).toBe('require_approval');
    expect(decision?.ruleId).toBe('refund_high_value');
    expect(result.text).not.toMatch(/re_test_\d+/);
  });
});

describe('S5 cancellation', () => {
  it('cancels at period end and states the stop date', async () => {
    const result = await turn('Cancel my plan sub_cancel.');

    expect(result.intent).toBe('CANCEL_SUBSCRIPTION');
    expect(result.finalState).toBe('RESOLVED');
    expect(result.toolsCalled).toContain('cancel_subscription');
    expect(result.text).toContain('sub_cancel');
  });
});

describe('handover and knowledge', () => {
  it('hands over immediately when the customer asks for a person', async () => {
    const result = await turn("I don't want to talk to a bot. Put me through to a person.");

    expect(result.intent).toBe('HUMAN_REQUEST');
    expect(result.finalState).toBe('NEEDS_HUMAN');
    expect(result.escalationReason).toBe('CUSTOMER_REQUESTED');
    expect(result.toolsCalled).toEqual([]);

    const escalation = await withTenant(TENANT).escalations.forRun(result.runId);
    expect(escalation?.reason).toBe('CUSTOMER_REQUESTED');
  });

  it('refuses to answer from memory when the knowledge base is empty', async () => {
    await sql()`UPDATE documents SET status = 'superseded' WHERE tenant_id = ${TENANT}`;

    const result = await turn('Please refund my last payment for sub_recent.');

    expect(result.finalState).toBe('NEEDS_HUMAN');
    expect(result.toolsCalled).toContain('search_knowledge');
    expect(result.toolsCalled).not.toContain('create_refund');
    expect(result.text).not.toMatch(/re_test_\d+/);
  });
});

describe('a run always leaves a trace', () => {
  it('records an assembled trace for every scenario input', async () => {
    for (const input of [
      'Please refund my last payment for sub_recent.',
      "I don't want to talk to a bot. Put me through to a person.",
    ]) {
      const result = await turn(input);
      const trace = await assembleTrace(TENANT, result.runId);
      expect(trace.run.finishedAt).not.toBeNull();
      expect(trace.run.finalState).not.toBeNull();
      expect(trace.run.outcome).not.toBeNull();
      expect(trace.conversation.messages.length).toBeGreaterThanOrEqual(2);
      expect(trace.llmCalls.length).toBeGreaterThan(0);
    }
  });
});

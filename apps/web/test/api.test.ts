import { serverEnv } from '@kora/core';
import { and, closeDb, conversations, db, eq, events, withTenant } from '@kora/db';
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
import { setBillingProvider, setTenantStripeKey } from '@kora/tools';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const afterCallbacks: Array<() => unknown> = [];

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    afterCallbacks.push(fn);
  },
}));

let requestHeaders = new Headers();
vi.mock('next/headers', () => ({
  headers: async () => requestHeaders,
}));

const { auth } = await import('@/lib/auth');
const { POST: createConversation } = await import('@/app/api/conversations/route');
const { GET: getConversation } = await import('@/app/api/conversations/[id]/route');
const { POST: sendMessage } = await import('@/app/api/chat/[conversationId]/route');
const { GET: listApprovals } = await import('@/app/api/approvals/route');
const { POST: decideApproval } = await import('@/app/api/approvals/[id]/decision/route');
const { GET: getMetrics } = await import('@/app/api/metrics/route');
const { closeRateLimiter } = await import('@/lib/rate-limit');

const H1 = 'Please refund my last payment for sub_recent.';

const tenantId = serverEnv().KORA_TENANT_ID;
const repos = withTenant(tenantId);
const created: string[] = [];

const KNOWLEDGE_DIR = join(import.meta.dirname, '../../../config/knowledge');

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);
const inr = (amountMinor: number) => ({ amountMinor, currency: 'INR' });

const STANDARD = 349900;
const HIGH = 899900;

function subscription(id: string, invoiceId: string): SubscriptionRecord {
  return {
    id,
    status: 'active',
    customerId: 'cus_api',
    items: [
      {
        subscriptionItemId: `si_${id}`,
        priceId: 'price_basic',
        productId: 'prod_basic',
        unitAmount: inr(STANDARD),
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
    customerId: 'cus_api',
    subscriptionId,
    amountDue: inr(amountMinor),
    amountPaid: inr(amountMinor),
    amountRemaining: inr(0),
    paymentIntentId: `pi_${id}`,
    chargeId: `ch_${id}`,
    created: nowSec(),
  };
}

function charge(id: string, invoiceId: string, amountMinor: number): ChargeRecord {
  return {
    id,
    amountCaptured: inr(amountMinor),
    amountRefunded: inr(0),
    remainingRefundable: inr(amountMinor),
    currency: 'INR',
    paymentIntentId: `pi_${invoiceId}`,
    invoiceId,
    customerId: 'cus_api',
    created: nowSec() - 5 * DAY,
    refunded: false,
  };
}

function stubProvider(): BillingProvider {
  const subs = new Map<string, SubscriptionRecord>([
    ['sub_recent', subscription('sub_recent', 'in_recent')],
    ['sub_high', subscription('sub_high', 'in_high')],
  ]);
  const invoices = new Map<string, InvoiceRecord>([
    ['in_recent', invoice('in_recent', 'sub_recent', STANDARD)],
    ['in_high', invoice('in_high', 'sub_high', HIGH)],
  ]);
  const charges = new Map<string, ChargeRecord>([
    ['in_recent', charge('ch_recent', 'in_recent', STANDARD)],
    ['in_high', charge('ch_high', 'in_high', HIGH)],
  ]);
  const refunds = new Map<string, RefundRecord>();
  const byKey = new Map<string, RefundRecord>();
  let n = 0;

  const notFound = (what: string): Error =>
    Object.assign(new Error(`no such ${what}`), { code: 'UPSTREAM_4XX' });

  return {
    getCustomer: async (id) => ({
      id,
      email: 'customer@example.test',
      name: 'API Test Customer',
      defaultPaymentMethodId: null,
      currency: 'INR',
    }),
    getSubscription: async (id) => {
      const sub = subs.get(id);
      if (!sub) throw notFound(`subscription ${id}`);
      return { ...sub, items: sub.items.map((item) => ({ ...item })) };
    },
    getInvoice: async (id) => {
      const inv = invoices.get(id);
      if (!inv) throw notFound(`invoice ${id}`);
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
        id: `re_api_${n}`,
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
      if (!sub) throw notFound('subscription');
      const next: SubscriptionRecord =
        input.mode === 'immediate'
          ? { ...sub, status: 'canceled', canceledAt: nowSec() }
          : { ...sub, cancelAtPeriodEnd: true, cancelAt: sub.currentPeriodEnd };
      subs.set(input.subscriptionId, next);
      return { ...next };
    },
    changePlan: async (input: PlanChangeInput) => {
      const sub = subs.get(input.subscriptionId);
      if (!sub) throw notFound('subscription');
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
      if (!record) throw notFound(`refund ${id}`);
      return { ...record };
    },
  };
}

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function newConversation(): Promise<string> {
  const res = await createConversation(post('http://localhost/api/conversations', {}));
  expect(res.status).toBe(201);
  const { conversationId } = (await res.json()) as { conversationId: string };
  created.push(conversationId);
  return conversationId;
}

async function signInAsOperator(): Promise<void> {
  const env = serverEnv();
  const res = await auth().api.signInEmail({
    body: { email: env.KORA_SEED_OPERATOR_EMAIL, password: env.KORA_SEED_OPERATOR_PASSWORD },
    asResponse: true,
  });
  expect(res.status).toBe(200);

  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c));
  expect(cookies.length).toBeGreaterThan(0);
  requestHeaders = new Headers({ cookie: cookies.join('; ') });
}

beforeAll(async () => {
  const { seed } = await import('@kora/db');
  const { ingestDirectory } = await import('@kora/ai');
  await seed();
  // The pipeline gates money writes on the tenant having a key. The stub provider
  // never reads it, but without a row every write stops before it runs.
  await setTenantStripeKey(tenantId, 'sk_test_api_route');
  // Idempotent: an unchanged file is skipped. Without knowledge the agent refuses
  // to act on policy at all, so no money turn would ever reach a tool.
  await ingestDirectory({ tenantId, dir: KNOWLEDGE_DIR });
});

beforeEach(() => {
  setBillingProvider(stubProvider());
});

afterAll(async () => {
  setBillingProvider(null);
  for (const id of created) {
    await db().delete(conversations).where(eq(conversations.id, id));
  }
  await closeRateLimiter();
  await closeDb();
});

describe('conversations and chat', () => {
  it('runs a turn and persists the assistant message with its parts', async () => {
    const conversationId = await newConversation();

    const res = await sendMessage(
      post(`http://localhost/api/chat/${conversationId}`, { message: H1 }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(res.status).toBe(200);

    const turn = (await res.json()) as { runId: string; traceId: string; text: string };
    expect(turn.runId).toMatch(/^run_/);
    expect(turn.traceId).toMatch(/^tr_/);
    expect(turn.text.length).toBeGreaterThan(0);

    const messages = await repos.messages.listForConversation(conversationId);
    const customer = messages.filter((m) => m.role === 'customer');
    const agent = messages.filter((m) => m.role === 'agent');

    expect(customer.map((m) => m.content)).toContain(H1);
    expect(agent.length).toBeGreaterThan(0);

    const last = agent.at(-1);
    expect(last?.content).toBe(turn.text);
    expect(last?.parts).toEqual([{ type: 'text', text: turn.text }]);

    const steps = await repos.steps.listForRun(turn.runId);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((s) => s.ordinal)).toEqual(steps.map((_, i) => i));
  });

  it('schedules evaluation after a terminal run instead of making the customer wait', async () => {
    const conversationId = await newConversation();
    const before = afterCallbacks.length;

    const res = await sendMessage(
      post(`http://localhost/api/chat/${conversationId}`, {
        message: 'I would rather talk to a human about this invoice.',
      }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(res.status).toBe(200);

    const turn = (await res.json()) as { finalState: string; runId: string };
    expect(turn.finalState).toBe('NEEDS_HUMAN');

    // The contract is that evaluation is scheduled, not where. With a reachable
    // Redis the `run.finished` event is enqueued and the worker owns it. With no
    // Redis the route falls back to `after()`. Neither path may drop the run.
    const [event] = await db()
      .select()
      .from(events)
      .where(and(eq(events.runId, turn.runId), eq(events.type, 'run.finished')));

    expect(event, 'no run.finished event was written for a terminal run').toBeDefined();
    if (event?.enqueued) {
      expect(afterCallbacks.length).toBe(before);
    } else {
      expect(afterCallbacks.length).toBe(before + 1);
    }
  });

  it('returns 404 for an unknown conversation id', async () => {
    const res = await sendMessage(
      post('http://localhost/api/chat/conv_does_not_exist', { message: 'hello' }),
      { params: Promise.resolve({ conversationId: 'conv_does_not_exist' }) },
    );
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string; traceId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.traceId).toMatch(/^tr_/);
  });

  it('rate limits at 30 messages a minute per conversation', async () => {
    const conversationId = await newConversation();

    // A malformed body still consumes a slot, which keeps this test from running
    // thirty full agent turns to prove one counter works.
    for (let i = 0; i < 30; i++) {
      const res = await sendMessage(
        post(`http://localhost/api/chat/${conversationId}`, { message: '' }),
        { params: Promise.resolve({ conversationId }) },
      );
      expect(res.status).toBe(400);
    }

    const limited = await sendMessage(
      post(`http://localhost/api/chat/${conversationId}`, { message: 'one too many' }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('operator routes', () => {
  it('rejects a request with no session', async () => {
    requestHeaders = new Headers();

    const conversationId = created[0] ?? 'conv_missing';
    const routes = [
      getConversation(new Request('http://localhost'), {
        params: Promise.resolve({ id: conversationId }),
      }),
      listApprovals(new Request('http://localhost/api/approvals?status=pending')),
      getMetrics(new Request('http://localhost/api/metrics')),
    ];

    for (const res of await Promise.all(routes)) {
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('signs the seeded operator in and serves the conversation', async () => {
    await signInAsOperator();

    const conversationId = created[0];
    expect(conversationId).toBeDefined();

    const res = await getConversation(new Request('http://localhost'), {
      params: Promise.resolve({ id: conversationId as string }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      conversation: { id: string };
      messages: Array<{ role: string }>;
      latestRunId: string | null;
    };
    expect(body.conversation.id).toBe(conversationId);
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.latestRunId).toMatch(/^run_/);
  });

  it('reports no data rather than NaN for an empty range', async () => {
    await signInAsOperator();

    const res = await getMetrics(
      new Request('http://localhost/api/metrics?from=1990-01-01&to=1990-03-01'),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      runs: { total: number; evaluated: number; pending: number };
      verifiedResolutionRate: number | null;
      automationRate: number | null;
      costPerResolutionUsdMicros: number | null;
    };
    expect(body).toMatchObject({
      runs: { total: 0, evaluated: 0, pending: 0 },
      verifiedResolutionRate: null,
      automationRate: null,
      costPerResolutionUsdMicros: null,
    });
  });
});

describe('approval decisions', () => {
  async function pendingApprovalFor(conversationId: string): Promise<string> {
    const pending = await repos.approvals.listPending();
    const match = pending.find((a) => a.conversationId === conversationId);
    expect(match, 'the high-value turn should have left an approval pending').toBeDefined();
    return match?.id as string;
  }

  // The last invoice on sub_high is INR 8,999, over the INR 5,000 threshold in the
  // refunds policy, so `refund_high_value` routes it to a person. sub_recent is
  // under it and resolves on its own.
  const HIGH_VALUE = 'Please refund my last payment for sub_high.';

  async function runHighValue(): Promise<string> {
    const conversationId = await newConversation();
    const res = await sendMessage(
      post(`http://localhost/api/chat/${conversationId}`, { message: HIGH_VALUE }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(res.status).toBe(200);
    return conversationId;
  }

  it('approving resumes the run and creates exactly one refund', async () => {
    await signInAsOperator();

    const conversationId = await runHighValue();
    const approvalId = await pendingApprovalFor(conversationId);

    const res = await decideApproval(
      post(`http://localhost/api/approvals/${approvalId}/decision`, { decision: 'approved' }),
      { params: Promise.resolve({ id: approvalId }) },
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      approval: { status: string; decidedBy: string | null };
      turn: { outcome: string; finalState: string; text: string; runId: string } | null;
    };
    expect(body.approval.status).toBe('approved');
    expect(body.approval.decidedBy).not.toBe('system');
    expect(body.turn?.finalState).toBe('RESOLVED');
    expect(body.turn?.text).toMatch(/re_api_\d+/);

    const executions = await repos.toolExecutions.listForRun(body.turn?.runId as string);
    const writes = executions.filter((e) => e.toolName === 'create_refund' && e.status === 'ok');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.verified).toBe(true);

    // Resuming after an approval must not write a second customer message: that
    // puts words in the customer's mouth.
    const messages = await repos.messages.listForConversation(conversationId);
    const fromCustomer = messages.filter((m) => m.role === 'customer');
    expect(fromCustomer).toHaveLength(1);
    expect(messages.some((m) => m.role === 'human_agent')).toBe(true);
  });

  it('returns 409 when the same approval is decided twice', async () => {
    await signInAsOperator();

    const conversationId = await runHighValue();
    const approvalId = await pendingApprovalFor(conversationId);

    const first = await decideApproval(
      post(`http://localhost/api/approvals/${approvalId}/decision`, {
        decision: 'denied',
        note: 'the billing team is handling this refund',
      }),
      { params: Promise.resolve({ id: approvalId }) },
    );
    expect(first.status).toBe(200);

    const second = await decideApproval(
      post(`http://localhost/api/approvals/${approvalId}/decision`, { decision: 'approved' }),
      { params: Promise.resolve({ id: approvalId }) },
    );
    expect(second.status).toBe(409);

    const body = (await second.json()) as { error: { code: string; traceId: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.traceId).toMatch(/^tr_/);

    const stored = await repos.approvals.get(approvalId);
    expect(stored?.status).toBe('denied');
    expect(stored?.decisionNote).toBe('the billing team is handling this refund');
    expect(stored?.decidedBy).not.toBe('system');
    expect(stored?.decidedAt).not.toBeNull();

    const run = await repos.runs.get(stored?.runId as string);
    expect(run?.finalState).toBe('NEEDS_HUMAN');
    expect(run?.errorCode).toBe('APPROVAL_DENIED');
  });

  it('returns 404 for an approval that does not exist', async () => {
    await signInAsOperator();

    const res = await decideApproval(
      post('http://localhost/api/approvals/apv_missing/decision', { decision: 'approved' }),
      { params: Promise.resolve({ id: 'apv_missing' }) },
    );
    expect(res.status).toBe(404);
  });
});

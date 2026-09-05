import { newId, now, serverEnv } from '@kora/core';
import {
  closeDb,
  db,
  eq,
  expireOverdueApprovals,
  listApprovalQueue,
  readApproval,
  schema,
} from '@kora/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { daysAgo, dropConversations, dropTenant, seedRuns } from './support/seed';

let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));
vi.mock('next/server', () => ({ after: () => {} }));

const { auth } = await import('@/lib/auth');
const { POST: decideRoute } = await import('@/app/api/approvals/[id]/decision/route');
const { GET: listRoute } = await import('@/app/api/approvals/route');
const { notifyApprovalPending } = await import('@/lib/notify/webhook');

const TENANT = 'ten_approvals_test';
const LIVE_TENANT = serverEnv().KORA_TENANT_ID;
const liveConversations: string[] = [];
let operatorId = '';

interface ApprovalSeed {
  tenantId: string;
  toolName: string;
  amountMinor: number | null;
  expiresAt: Date;
  status?: 'pending' | 'approved' | 'denied' | 'expired';
  requestedAt?: Date;
  useFacts?: boolean;
}

async function seedApproval(spec: ApprovalSeed): Promise<{ id: string; conversationId: string }> {
  const [run] = await seedRuns(spec.tenantId, [
    {
      intent: 'REFUND_REQUEST',
      outcome: 'escalated',
      finalState: 'AWAITING_APPROVAL',
      durationMs: 500,
      costUsdMicros: 100,
      startedAt: spec.requestedAt ?? daysAgo(0),
    },
  ]);
  if (!run) throw new Error('the fixture run was not created');
  if (spec.tenantId === LIVE_TENANT) liveConversations.push(run.conversationId);

  await db()
    .insert(schema.messages)
    .values({
      id: newId('msg'),
      tenantId: spec.tenantId,
      conversationId: run.conversationId,
      role: 'customer',
      content: 'My order arrived damaged.',
      parts: [],
      createdAt: spec.requestedAt ?? daysAgo(0),
    });

  let policyCheckId: string | null = null;
  if (spec.useFacts && spec.amountMinor !== null) {
    policyCheckId = newId('pck');
    await db()
      .insert(schema.policyChecks)
      .values({
        id: policyCheckId,
        tenantId: spec.tenantId,
        runId: run.runId,
        policyKey: 'acme-refunds',
        policyVersion: '1.0.0',
        ruleId: 'high_value_needs_approval',
        action: spec.toolName,
        decision: 'require_approval',
        reason: 'over the threshold',
        facts: { amountMinor: spec.amountMinor, currency: 'INR' },
      });
  }

  const id = newId('apv');
  await db()
    .insert(schema.approvals)
    .values({
      id,
      tenantId: spec.tenantId,
      runId: run.runId,
      conversationId: run.conversationId,
      toolName: spec.toolName,
      proposedInput:
        spec.useFacts || spec.amountMinor === null
          ? { orderId: '9833' }
          : { orderId: '9833', amountMinor: spec.amountMinor, currency: 'INR' },
      reason: 'needs a person',
      status: spec.status ?? 'pending',
      requestedAt: spec.requestedAt ?? daysAgo(0),
      expiresAt: spec.expiresAt,
      ...(policyCheckId ? { policyCheckId } : {}),
      ...(spec.status === 'approved' || spec.status === 'denied'
        ? { decidedAt: now(), decidedBy: operatorId }
        : {}),
    });

  return { id, conversationId: run.conversationId };
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

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const inAnHour = () => new Date(now().getTime() + 60 * 60 * 1000);
const anHourAgo = () => new Date(now().getTime() - 60 * 60 * 1000);

beforeAll(async () => {
  const { seed } = await import('@kora/db');
  await seed();
  await dropTenant(TENANT);

  const [operator] = await db()
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, serverEnv().KORA_SEED_OPERATOR_EMAIL));
  operatorId = operator?.id ?? '';
  expect(operatorId).not.toBe('');
});

afterAll(async () => {
  await dropTenant(TENANT);
  await dropConversations(liveConversations);
  await closeDb();
});

describe('lazy expiry', () => {
  it('reads an overdue approval as expired even though the sweep never ran', async () => {
    const { id } = await seedApproval({
      tenantId: TENANT,
      toolName: 'create_refund',
      amountMinor: 250000,
      requestedAt: new Date(now().getTime() - 2 * 60 * 60 * 1000),
      expiresAt: anHourAgo(),
    });

    const raw = await db().select().from(schema.approvals).where(eq(schema.approvals.id, id));
    expect(raw[0]?.status, 'the stored row is still pending before the read').toBe('pending');

    const approval = await readApproval(TENANT, id);
    expect(approval?.status).toBe('expired');

    const queue = await listApprovalQueue(TENANT, { status: 'pending' });
    expect(queue.some((a) => a.id === id)).toBe(false);
  });

  it('escalates and tells the customer a person will follow up', async () => {
    const { id, conversationId } = await seedApproval({
      tenantId: TENANT,
      toolName: 'create_replacement',
      amountMinor: 800000,
      expiresAt: anHourAgo(),
    });

    await readApproval(TENANT, id);

    const [escalation] = await db()
      .select()
      .from(schema.escalations)
      .where(eq(schema.escalations.conversationId, conversationId));
    expect(escalation?.reason).toBe('APPROVAL_DENIED');
    expect(escalation?.status).toBe('open');

    const messages = await db()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId));
    const reply = messages.find((m) => m.role === 'agent');
    expect(reply?.content).toMatch(/follow up/i);

    const [conversation] = await db()
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    expect(conversation?.state).toBe('NEEDS_HUMAN');
    expect(conversation?.outcome).toBe('escalated');
  });

  it('sweeps the backlog exactly once, which is what the CLI calls', async () => {
    await seedApproval({
      tenantId: TENANT,
      toolName: 'create_refund',
      amountMinor: 1000,
      expiresAt: anHourAgo(),
    });

    const first = await expireOverdueApprovals(TENANT);
    expect(first.length).toBeGreaterThanOrEqual(1);

    const second = await expireOverdueApprovals(TENANT);
    expect(second).toHaveLength(0);
  });

  it('never hard-deletes an approval', async () => {
    const { id } = await seedApproval({
      tenantId: TENANT,
      toolName: 'create_refund',
      amountMinor: 500,
      expiresAt: anHourAgo(),
    });
    await readApproval(TENANT, id);

    const expired = await listApprovalQueue(TENANT, { status: 'expired' });
    expect(expired.some((a) => a.id === id)).toBe(true);
  });
});

describe('queue ordering and filters', () => {
  const created: string[] = [];

  beforeAll(async () => {
    for (const [tool, amount, useFacts] of [
      ['create_refund', 120000, false],
      ['create_replacement', 899900, true],
      ['cancel_order', 4500, false],
    ] as const) {
      const { id } = await seedApproval({
        tenantId: TENANT,
        toolName: tool,
        amountMinor: amount,
        expiresAt: inAnHour(),
        useFacts,
      });
      created.push(id);
    }
  });

  it('puts the most money at risk first, from facts or from the arguments', async () => {
    const queue = await listApprovalQueue(TENANT, { status: 'pending' });
    const amounts = queue.map((a) => a.amountMinor ?? 0);

    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    expect(queue[0]?.amountMinor).toBe(899900);
    expect(queue[0]?.ruleId).toBe('high_value_needs_approval');
  });

  it('filters by tool and by value band', async () => {
    const byTool = await listApprovalQueue(TENANT, {
      status: 'pending',
      toolName: 'create_refund',
    });
    expect(byTool.every((a) => a.toolName === 'create_refund')).toBe(true);

    const band = await listApprovalQueue(TENANT, {
      status: 'pending',
      minValueMinor: 100000,
      maxValueMinor: 500000,
    });
    expect(band.map((a) => a.amountMinor)).toEqual([120000]);

    const top = await listApprovalQueue(TENANT, { status: 'pending', minValueMinor: 500000 });
    expect(top.map((a) => a.amountMinor)).toEqual([899900]);
  });

  it('separates decided from pending and expired', async () => {
    const pending = await listApprovalQueue(TENANT, { status: 'pending' });
    expect(pending.every((a) => a.status === 'pending')).toBe(true);

    const expired = await listApprovalQueue(TENANT, { status: 'expired' });
    expect(expired.every((a) => a.status === 'expired')).toBe(true);

    const all = await listApprovalQueue(TENANT, { status: 'all' });
    expect(all.length).toBeGreaterThanOrEqual(pending.length + expired.length);
  });
});

describe('decisions', () => {
  it('lets the first decision win and tells the second who made it', async () => {
    await signInAsOperator();
    const { id } = await seedApproval({
      tenantId: LIVE_TENANT,
      toolName: 'create_refund',
      amountMinor: 700000,
      expiresAt: inAnHour(),
    });

    const [first, second] = await Promise.all([
      decideRoute(post(`http://localhost/api/approvals/${id}/decision`, { decision: 'denied' }), {
        params: Promise.resolve({ id }),
      }),
      decideRoute(post(`http://localhost/api/approvals/${id}/decision`, { decision: 'denied' }), {
        params: Promise.resolve({ id }),
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const losing = first.status === 409 ? first : second;
    const body = (await losing.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('already denied');
    expect(body.error.message).toContain('Acme Operator');
  });

  it('answers a decision on an expired approval with 410', async () => {
    await signInAsOperator();
    const { id } = await seedApproval({
      tenantId: LIVE_TENANT,
      toolName: 'create_refund',
      amountMinor: 300000,
      requestedAt: new Date(now().getTime() - 3 * 60 * 60 * 1000),
      expiresAt: anHourAgo(),
    });

    const res = await decideRoute(
      post(`http://localhost/api/approvals/${id}/decision`, { decision: 'approved' }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(410);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('GONE');
    expect(body.error.message).toContain('expired');

    const stored = await readApproval(LIVE_TENANT, id);
    expect(stored?.status).toBe('expired');
  });

  it('reports missing approvals as 404', async () => {
    await signInAsOperator();
    const res = await decideRoute(
      post('http://localhost/api/approvals/apv_nope/decision', { decision: 'approved' }),
      { params: Promise.resolve({ id: 'apv_nope' }) },
    );
    expect(res.status).toBe(404);
  });

  it('serves the queue over HTTP without leaking a raw row', async () => {
    await signInAsOperator();
    const res = await listRoute(new Request('http://localhost/api/approvals?status=all'));
    expect(res.status).toBe(200);

    const { approvals } = (await res.json()) as {
      approvals: Array<Record<string, unknown>>;
    };
    for (const approval of approvals) {
      expect(approval).not.toHaveProperty('tenantId');
      expect(approval).not.toHaveProperty('toolExecutionId');
      expect(typeof approval.requestedAt).toBe('string');
    }
  });

  it('rejects an unauthenticated decision', async () => {
    requestHeaders = new Headers();
    const res = await decideRoute(
      post('http://localhost/api/approvals/apv_x/decision', { decision: 'approved' }),
      { params: Promise.resolve({ id: 'apv_x' }) },
    );
    expect(res.status).toBe(401);
  });
});

describe('the pending-approval webhook', () => {
  const notification = {
    approvalId: 'apv_1',
    conversationId: 'conv_1',
    runId: 'run_1',
    toolName: 'create_refund',
    reason: 'needs a person',
    amountMinor: 500000,
    currency: 'INR',
    requestedAt: now().toISOString(),
    expiresAt: inAnHour().toISOString(),
    url: 'http://localhost:3000/ops/approvals',
  };

  it('drops a dead endpoint instead of throwing', async () => {
    const delivered = await notifyApprovalPending(notification, 'http://127.0.0.1:9/nowhere');
    expect(delivered).toBe(false);
  });

  it('posts the approval to a live endpoint', async () => {
    const received: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      received.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    });

    const delivered = await notifyApprovalPending(notification, 'http://example.test/hook');
    fetchSpy.mockRestore();

    expect(delivered).toBe(true);
    expect(received).toEqual([{ type: 'approval.pending', approval: notification }]);
  });

  it('is not configured until KORA_APPROVAL_WEBHOOK_URL exists in the env schema', async () => {
    const { approvalWebhookUrl } = await import('@/lib/notify/webhook');
    expect(approvalWebhookUrl()).toBeNull();
  });
});

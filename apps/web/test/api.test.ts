import { serverEnv } from '@kora/core';
import { closeDb, conversations, db, eq, withTenant } from '@kora/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

const H1 = 'My coffee machine from order 9832 arrived broken. I want a replacement.';

const tenantId = serverEnv().KORA_TENANT_ID;
const repos = withTenant(tenantId);
const created: string[] = [];

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

async function resetOrder(orderId: string): Promise<void> {
  const env = serverEnv();
  const res = await fetch(`${env.ACME_BASE_URL}/admin/reset`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.ACME_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ orderIds: [orderId] }),
  });
  expect(res.status, 'the Acme mock must be running on ACME_BASE_URL').toBe(200);
}

beforeAll(async () => {
  const { seed } = await import('@kora/db');
  await seed();
  await resetOrder('9832');
});

afterAll(async () => {
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
        message: 'I would rather talk to a human about order 9832.',
      }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(res.status).toBe(200);

    const turn = (await res.json()) as { finalState: string; outcome: string };
    expect(turn.finalState).toBe('NEEDS_HUMAN');
    expect(afterCallbacks.length).toBe(before + 1);
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

  it('reports metrics as zeros rather than NaN for an empty range', async () => {
    await signInAsOperator();

    const res = await getMetrics(
      new Request('http://localhost/api/metrics?from=1990-01-01&to=1990-01-02'),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      totalRuns: number;
      verifiedResolutionRate: number | null;
      evaluatedCount: number;
      avgLatencyMs: number;
      avgCostUsdMicros: number;
    };
    expect(body).toMatchObject({
      totalRuns: 0,
      verifiedResolutionRate: null,
      evaluatedCount: 0,
      avgLatencyMs: 0,
      avgCostUsdMicros: 0,
    });
  });
});

describe('approval decisions', () => {
  async function pendingApprovalFor(conversationId: string): Promise<string> {
    const pending = await repos.approvals.listPending();
    const match = pending.find((a) => a.conversationId === conversationId);
    expect(match, 'the H1 turn should have left an approval pending').toBeDefined();
    return match?.id as string;
  }

  async function runH1(): Promise<string> {
    const conversationId = await newConversation();
    const res = await sendMessage(
      post(`http://localhost/api/chat/${conversationId}`, { message: H1 }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(res.status).toBe(200);
    return conversationId;
  }

  it('approving resumes the run and creates exactly one replacement', async () => {
    await resetOrder('9832');
    await signInAsOperator();

    const conversationId = await runH1();
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
    expect(body.turn?.text).toMatch(/REP-\d+/);

    const executions = await repos.toolExecutions.listForRun(body.turn?.runId as string);
    const writes = executions.filter(
      (e) => e.toolName === 'create_replacement' && e.status === 'ok',
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.verified).toBe(true);
  });

  it('returns 409 when the same approval is decided twice', async () => {
    await resetOrder('9832');
    await signInAsOperator();

    const conversationId = await runH1();
    const approvalId = await pendingApprovalFor(conversationId);

    const first = await decideApproval(
      post(`http://localhost/api/approvals/${approvalId}/decision`, {
        decision: 'denied',
        note: 'the returns desk handles this order',
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
    expect(stored?.decisionNote).toBe('the returns desk handles this order');
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

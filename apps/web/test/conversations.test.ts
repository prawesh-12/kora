import { serverEnv } from '@kora/core';
import { closeDb, decodeCursor, encodeCursor, listConversationSummaries } from '@kora/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type RunSpec, daysAgo, dropTenant, seedRuns } from './support/seed';

let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));
vi.mock('next/server', () => ({ after: () => {} }));

const { auth } = await import('@/lib/auth');
const { GET: listConversations } = await import('@/app/api/conversations/route');

const TENANT = 'ten_conversations_test';
const START = daysAgo(1);
const TOTAL = 60;

function fixture(): RunSpec[] {
  return Array.from({ length: TOTAL }, (_, i) => {
    const failing = i % 5 === 0;
    return {
      intent: failing ? 'REFUND_REQUEST' : 'REFUND_REQUEST',
      outcome: failing ? 'failed' : 'resolved_automatically',
      finalState: failing ? 'ACTION_FAILED' : 'RESOLVED',
      durationMs: 100 + i,
      costUsdMicros: 50,
      startedAt: new Date(START.getTime() + i * 1000),
      evaluation: {
        verifiedResolution: !failing,
        ...(failing ? { failureCodes: ['POLICY_FAILURE' as const] } : {}),
      },
      ...(failing ? { escalation: { status: 'open' as const } } : {}),
    } satisfies RunSpec;
  });
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

async function pageThrough(limit: number): Promise<string[]> {
  const visited: string[] = [];
  let cursor: string | undefined;

  for (let guard = 0; guard < 100; guard++) {
    const page = await listConversationSummaries({
      tenantId: TENANT,
      limit,
      ...(cursor ? { cursor: decodeCursor(cursor) ?? undefined } : {}),
    });
    visited.push(...page.items.map((i) => i.runId));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return visited;
}

describe('cursor pagination', () => {
  it('walks the whole set once, newest first', async () => {
    const visited = await pageThrough(7);

    expect(visited).toHaveLength(TOTAL);
    expect(new Set(visited).size).toBe(TOTAL);
  });

  it('visits every original row exactly once while new rows arrive mid-page', async () => {
    const before = await listConversationSummaries({ tenantId: TENANT, limit: TOTAL });
    const original = new Set(before.items.map((i) => i.runId));

    const visited: string[] = [];
    let cursor: string | undefined;
    let inserted = 0;

    for (let guard = 0; guard < 100; guard++) {
      const page = await listConversationSummaries({
        tenantId: TENANT,
        limit: 9,
        ...(cursor ? { cursor: decodeCursor(cursor) ?? undefined } : {}),
      });
      visited.push(...page.items.map((i) => i.runId));

      // A run that lands now sorts above the cursor, so keyset paging never sees
      // it and never shifts the rows still to come. Offset paging would skip one.
      if (inserted < 3) {
        await seedRuns(TENANT, [
          {
            intent: 'BILLING_QUESTION',
            outcome: 'resolved_automatically',
            durationMs: 10,
            costUsdMicros: 1,
            startedAt: daysAgo(0),
          },
        ]);
        inserted++;
      }

      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const seen = visited.filter((id) => original.has(id));
    expect(new Set(seen).size).toBe(TOTAL);
    expect(seen).toHaveLength(TOTAL);
  });

  it('round-trips a cursor and rejects one it did not issue', async () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    const encoded = encodeCursor({ startedAt: at, id: 'run_abc' });
    expect(decodeCursor(encoded)).toEqual({ startedAt: at, id: 'run_abc' });

    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(Buffer.from('nope', 'utf8').toString('base64url'))).toBeNull();
  });
});

describe('filters', () => {
  const expected = [
    [{ outcome: 'failed' as const }, 12],
    [{ intent: 'REFUND_REQUEST' as const }, 12],
    [{ failureCode: 'POLICY_FAILURE' as const }, 12],
    [{ verified: false }, 12],
    [{ verified: true }, 48],
    [{ escalated: true }, 12],
    [{ escalated: false }, 48],
    [{ escalationStatus: 'open' as const }, 12],
    [{ outcome: 'failed' as const, verified: false, escalated: true }, 12],
    [{ outcome: 'failed' as const, verified: true }, 0],
  ] as const;

  // Bounded to the fixture window so rows another test inserted cannot drift these.
  const window = { from: START, to: new Date(START.getTime() + TOTAL * 1000) };

  it('returns the same rows for every filter combination', async () => {
    for (const [filter, count] of expected) {
      const page = await listConversationSummaries({
        tenantId: TENANT,
        limit: 200,
        ...window,
        ...filter,
      });
      expect(page.items.length, JSON.stringify(filter)).toBe(count);
    }
  });

  it('confines a date range to the rows inside it', async () => {
    const page = await listConversationSummaries({
      tenantId: TENANT,
      limit: 200,
      from: START,
      to: new Date(START.getTime() + 9 * 1000),
    });
    expect(page.items).toHaveLength(10);
  });
});

describe('GET /api/conversations', () => {
  it('serves a page and a cursor that fetches the next one', async () => {
    await signInAsOperator();

    const first = await listConversations(
      new Request('http://localhost/api/conversations?limit=5'),
    );
    expect(first.status).toBe(200);

    const page = (await first.json()) as {
      items: Array<{ runId: string; verifiedResolution: boolean | null; costUsdMicros: number }>;
      nextCursor: string | null;
    };
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeTruthy();
    expect(page.items[0]).not.toHaveProperty('tenantId');
    expect(typeof page.items[0]?.costUsdMicros).toBe('number');

    const second = await listConversations(
      new Request(
        `http://localhost/api/conversations?limit=5&cursor=${encodeURIComponent(
          page.nextCursor as string,
        )}`,
      ),
    );
    expect(second.status).toBe(200);

    const next = (await second.json()) as { items: Array<{ runId: string }> };
    const overlap = next.items.filter((i) => page.items.some((p) => p.runId === i.runId));
    expect(overlap).toHaveLength(0);
  });

  it('answers an invalid cursor with 400, not 500', async () => {
    await signInAsOperator();

    const res = await listConversations(
      new Request('http://localhost/api/conversations?cursor=obviously-not-a-cursor'),
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toContain('cursor');
  });

  it('keeps the M0 POST behaviour that creates a conversation', async () => {
    const { POST: createConversation } = await import('@/app/api/conversations/route');
    const res = await createConversation(
      new Request('http://localhost/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(201);

    const { conversationId } = (await res.json()) as { conversationId: string };
    expect(conversationId).toMatch(/^conv_/);

    const { db, eq, schema } = await import('@kora/db');
    await db().delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
  });

  it('rejects an unauthenticated request', async () => {
    requestHeaders = new Headers();
    const res = await listConversations(new Request('http://localhost/api/conversations'));
    expect(res.status).toBe(401);
  });
});

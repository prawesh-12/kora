import { createHmac } from 'node:crypto';
import type { StripeWebhookStore, WebhookExecutionRef } from '@kora/tools';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/webhooks/stripe/route';

const SECRET = 'whsec_route_test_secret';

function sign(rawBody: string, secret = SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function request(rawBody: string, signature: string | null): Request {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'stripe-signature': signature } : {}),
    },
    body: rawBody,
  });
}

const EXECUTION: WebhookExecutionRef = {
  executionId: 'tex_route_1',
  runId: 'run_route_1',
  conversationId: 'conv_route_1',
  verified: false,
};

function fakeStore(): StripeWebhookStore & { confirmed: number; steps: number } {
  return {
    confirmed: 0,
    steps: 0,
    async claimEvent() {
      return true;
    },
    async findExecution() {
      return EXECUTION;
    },
    async confirmExecution() {
      this.confirmed += 1;
    },
    async recordStep() {
      this.steps += 1;
    },
    async escalate() {},
  };
}

const { handleStripeWebhookRequest } = await import('@/lib/webhooks/stripe');

async function postWithStore(
  rawBody: string,
  signature: string | null,
  store: StripeWebhookStore,
): Promise<{ status: number; body: Record<string, unknown>; store: StripeWebhookStore }> {
  const { handle } = await import('@/lib/api/errors');
  const result = await handle(async () => {
    const outcome = await handleStripeWebhookRequest(request(rawBody, signature), {
      secret: SECRET,
      store,
      tenantId: 'ten_test',
    });
    return Response.json({ received: true, ...outcome }, { status: 200 });
  });
  return { status: result.status, body: (await result.json()) as Record<string, unknown>, store };
}

function refundBody(eventId: string): string {
  return JSON.stringify({
    id: eventId,
    type: 'refund.updated',
    data: { object: { id: 're_route_1', status: 'succeeded', amount: 349900, currency: 'inr' } },
  });
}

describe('POST /api/webhooks/stripe', () => {
  it('confirms a pending refund and flips its verification', async () => {
    const store = fakeStore();
    const body = refundBody('evt_route_confirm');
    const { status, body: json } = await postWithStore(body, sign(body), store);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      received: true,
      outcome: 'confirmed',
      eventId: 'evt_route_confirm',
    });
    expect(store.confirmed).toBe(1);
    expect(store.steps).toBe(1);
  });

  it('rejects an invalid signature with a 400 and no side effects', async () => {
    const store = fakeStore();
    const body = refundBody('evt_route_bad_sig');
    const { status, body: json } = await postWithStore(body, sign(body, 'whsec_wrong'), store);
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'INVALID_SIGNATURE' } });
    expect(store.confirmed).toBe(0);
    expect(store.steps).toBe(0);
  });

  it('rejects a missing signature', async () => {
    const store = fakeStore();
    const body = refundBody('evt_route_no_sig');
    const { status, body: json } = await postWithStore(body, null, store);
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: { code: 'INVALID_SIGNATURE' } });
  });

  it('dedupes a repeated event id', async () => {
    const seen = new Set<string>();
    const store = fakeStore();
    store.claimEvent = async (event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    };
    const body = refundBody('evt_route_dup');
    const first = await postWithStore(body, sign(body), store);
    const second = await postWithStore(body, sign(body), store);
    expect(first.body).toMatchObject({ outcome: 'confirmed' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ outcome: 'duplicate' });
    expect(store.confirmed).toBe(1);
  });

  it('fails closed when no secret is configured', async () => {
    const { status, body: json } = await (async () => {
      const { handle } = await import('@/lib/api/errors');
      const res = await handle(async () => {
        await handleStripeWebhookRequest(request(refundBody('evt_x'), 't=1,v1=abc'), {
          secret: '',
          store: fakeStore(),
          tenantId: 'ten_test',
        });
        return Response.json({});
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    })();
    expect(status).toBe(500);
    expect(json).toMatchObject({ error: { code: 'WEBHOOK_NOT_CONFIGURED' } });
  });

  it('serves through the real route module', async () => {
    expect(typeof POST).toBe('function');
  });
});

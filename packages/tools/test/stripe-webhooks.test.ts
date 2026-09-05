import { createHmac } from 'node:crypto';
import { encryptSecret } from '@kora/core';
import { describe, expect, it } from 'vitest';
import {
  StripeWebhookError,
  parseStripeEvent,
  processStripeWebhook,
  resolveWebhookSecret,
  stripeEventFamily,
  verifyStripeSignature,
  type StripeWebhookStore,
  type WebhookExecutionRef,
} from '../src/stripe-webhooks.js';

const SECRET = 'whsec_test_secret_for_kora_webhooks';

function sign(rawBody: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function refundEvent(id: string, status: string): string {
  return JSON.stringify({
    id,
    type: 'refund.updated',
    data: {
      object: { id: 're_test_123', status, amount: 349900, currency: 'inr', charge: 'ch_test_1' },
    },
  });
}

function fakeStore(execution: WebhookExecutionRef | null = null): StripeWebhookStore & {
  claimed: string[];
  confirmed: Array<{ executionId: string; observed: unknown }>;
  steps: Array<{ runId: string; payload: Record<string, unknown>; status: string }>;
  escalations: Array<{ runId: string; reason: string; note: string }>;
} {
  return {
    claimed: [],
    confirmed: [],
    steps: [],
    escalations: [],
    async claimEvent(event) {
      if (this.claimed.includes(event.id)) return false;
      this.claimed.push(event.id);
      return true;
    },
    async findExecution() {
      return execution;
    },
    async confirmExecution(executionId, observed) {
      this.confirmed.push({ executionId, observed });
    },
    async recordStep(runId, payload, status) {
      this.steps.push({ runId, payload, status: status ?? 'ok' });
    },
    async escalate(input) {
      this.escalations.push({ runId: input.runId, reason: input.reason, note: input.note });
    },
  };
}

const EXECUTION: WebhookExecutionRef = {
  executionId: 'tex_1',
  runId: 'run_1',
  conversationId: 'conv_1',
  verified: false,
};

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = refundEvent('evt_1', 'succeeded');
    expect(verifyStripeSignature(body, sign(body), SECRET)).toBeGreaterThan(0);
  });

  it('rejects a tampered body', () => {
    const body = refundEvent('evt_1', 'succeeded');
    const tampered = body.replace('succeeded', 'failed');
    expect(() => verifyStripeSignature(tampered, sign(body), SECRET)).toThrowError(
      StripeWebhookError,
    );
    try {
      verifyStripeSignature(tampered, sign(body), SECRET);
    } catch (e) {
      expect((e as StripeWebhookError).code).toBe('SIGNATURE_MISMATCH');
    }
  });

  it('rejects a wrong secret', () => {
    const body = refundEvent('evt_1', 'succeeded');
    expect(() => verifyStripeSignature(body, sign(body, 'whsec_wrong'), SECRET)).toThrowError(
      StripeWebhookError,
    );
  });

  it('rejects a stale timestamp', () => {
    const body = refundEvent('evt_1', 'succeeded');
    const old = Math.floor(Date.now() / 1000) - 3600;
    try {
      verifyStripeSignature(body, sign(body, SECRET, old), SECRET);
      expect.unreachable();
    } catch (e) {
      expect((e as StripeWebhookError).code).toBe('BAD_TIMESTAMP');
    }
  });

  it('rejects a missing header', () => {
    const body = refundEvent('evt_1', 'succeeded');
    try {
      verifyStripeSignature(body, null, SECRET);
      expect.unreachable();
    } catch (e) {
      expect((e as StripeWebhookError).code).toBe('MISSING_SIGNATURE');
    }
  });

  it('never includes the secret in an error message', () => {
    const body = refundEvent('evt_1', 'succeeded');
    try {
      verifyStripeSignature(body, sign(body, 'whsec_wrong'), SECRET);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET);
      expect((e as Error).message).not.toContain('whsec_wrong');
    }
  });
});

describe('resolveWebhookSecret', () => {
  it('passes a raw endpoint secret through', () => {
    expect(resolveWebhookSecret(SECRET)).toBe(SECRET);
  });

  it('decrypts a blob produced by the existing secret helper', () => {
    expect(resolveWebhookSecret(encryptSecret(SECRET))).toBe(SECRET);
  });

  it('fails closed when nothing is configured', () => {
    expect(() => resolveWebhookSecret(undefined)).toThrowError(StripeWebhookError);
    expect(() => resolveWebhookSecret('')).toThrowError(StripeWebhookError);
  });
});

describe('stripeEventFamily', () => {
  it('handles the refund family', () => {
    for (const type of ['refund.created', 'refund.updated', 'refund.failed']) {
      expect(stripeEventFamily(type)).toBe('refund');
    }
  });

  it('handles the subscription family', () => {
    for (const type of ['customer.subscription.updated', 'customer.subscription.deleted']) {
      expect(stripeEventFamily(type)).toBe('subscription');
    }
  });

  it('ignores everything else, including charge-level refund events', () => {
    for (const type of [
      'charge.refunded',
      'charge.refund.updated',
      'invoice.paid',
      'customer.created',
    ]) {
      expect(stripeEventFamily(type)).toBe('ignored');
    }
  });
});

describe('parseStripeEvent', () => {
  it('rejects bodies that are not stripe events', () => {
    expect(() => parseStripeEvent('not json')).toThrowError(StripeWebhookError);
    expect(() => parseStripeEvent('{"id":"evt_1"}')).toThrowError(StripeWebhookError);
  });
});

describe('processStripeWebhook', () => {
  it('flips a pending refund execution to confirmed on succeeded', async () => {
    const store = fakeStore(EXECUTION);
    const body = refundEvent('evt_confirm_1', 'succeeded');
    const result = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    expect(result).toMatchObject({ outcome: 'confirmed', eventId: 'evt_confirm_1' });
    expect(store.confirmed).toHaveLength(1);
    expect(store.confirmed[0]?.executionId).toBe('tex_1');
    expect(store.steps).toHaveLength(1);
    expect(store.steps[0]).toMatchObject({ runId: 'run_1', status: 'ok' });
    expect(store.escalations).toHaveLength(0);
  });

  it('rejects an invalid signature before touching the store', async () => {
    const store = fakeStore(EXECUTION);
    const body = refundEvent('evt_bad_sig', 'succeeded');
    await expect(
      processStripeWebhook({
        rawBody: body,
        signature: sign(body, 'whsec_wrong'),
        secret: SECRET,
        store,
      }),
    ).rejects.toThrowError(StripeWebhookError);
    expect(store.claimed).toHaveLength(0);
    expect(store.confirmed).toHaveLength(0);
  });

  it('treats a duplicate event id as a no-op', async () => {
    const store = fakeStore(EXECUTION);
    const body = refundEvent('evt_dup_1', 'succeeded');
    const first = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    const second = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    expect(first.outcome).toBe('confirmed');
    expect(second.outcome).toBe('duplicate');
    expect(store.confirmed).toHaveLength(1);
    expect(store.steps).toHaveLength(1);
  });

  it('escalates a failed refund instead of confirming it', async () => {
    const store = fakeStore(EXECUTION);
    const body = refundEvent('evt_fail_1', 'failed');
    const result = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    expect(result.outcome).toBe('escalated');
    expect(store.confirmed).toHaveLength(0);
    expect(store.escalations).toHaveLength(1);
    expect(store.escalations[0]).toMatchObject({ runId: 'run_1', reason: 'VERIFICATION_FAILED' });
  });

  it('leaves a pending refund waiting with a trace record', async () => {
    const store = fakeStore(EXECUTION);
    const body = refundEvent('evt_pending_1', 'pending');
    const result = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    expect(result.outcome).toBe('noted');
    expect(store.confirmed).toHaveLength(0);
    expect(store.escalations).toHaveLength(0);
    expect(store.steps).toHaveLength(1);
  });

  it('confirms an at-period-end cancellation on subscription deleted', async () => {
    const store = fakeStore(EXECUTION);
    const body = JSON.stringify({
      id: 'evt_sub_1',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test_1', status: 'canceled' } },
    });
    const result = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    expect(result.outcome).toBe('confirmed');
    expect(store.confirmed).toHaveLength(1);
  });

  it('notes a handled event with no matching run instead of crashing', async () => {
    const store = fakeStore(null);
    const body = refundEvent('evt_orphan_1', 'succeeded');
    const result = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    expect(result.outcome).toBe('noted');
    expect(store.confirmed).toHaveLength(0);
  });

  it('acknowledges unhandled event types without claiming them', async () => {
    const store = fakeStore(EXECUTION);
    const body = JSON.stringify({
      id: 'evt_other_1',
      type: 'invoice.paid',
      data: { object: { id: 'in_test_1' } },
    });
    const result = await processStripeWebhook({
      rawBody: body,
      signature: sign(body),
      secret: SECRET,
      store,
    });
    expect(result.outcome).toBe('ignored');
    expect(store.claimed).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { setBillingProvider } from '../src/billing/provider.js';
import type { BillingProvider, RefundRecord } from '../src/billing/types.js';
import { deriveKey } from '../src/idempotency.js';
import { cancelSubscription } from '../src/tools/cancel-subscription.js';
import { changePlan } from '../src/tools/change-plan.js';
import { createRefund } from '../src/tools/create-refund.js';
import type { ToolContext } from '../src/types.js';

const TENANT = 'ten_billing_key_test';
const CONVERSATION = 'conv_billing_key_test';

function ctxFor(idempotencyKey: string): ToolContext {
  return {
    tenantId: TENANT,
    conversationId: CONVERSATION,
    idempotencyKey,
    signal: AbortSignal.timeout(10_000),
    gathered: {},
  } as unknown as ToolContext;
}

function keyFor(toolName: string, toolVersion: number, input: unknown): string {
  return deriveKey({
    tenantId: TENANT,
    conversationId: CONVERSATION,
    toolName,
    toolVersion,
    input,
  });
}

const AT_S = Math.floor(Date.parse('2026-08-27T12:00:00.000Z') / 1000);

function stripeLikeProvider() {
  const refunds = new Map<string, RefundRecord>();
  let creations = 0;
  const provider: BillingProvider = {
    getCustomer: () => Promise.reject(new Error('unused')),
    getSubscription: () =>
      Promise.resolve({
        id: 'sub_1S',
        status: 'active',
        customerId: 'cus_014',
        items: [],
        currentPeriodEnd: AT_S,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelAt: null,
        latestInvoiceId: 'in_1S',
        collectionMethod: 'charge_automatically',
      }),
    getInvoice: () => Promise.reject(new Error('unused')),
    resolveChargeForInvoice: () =>
      Promise.resolve({
        id: 'ch_1S',
        amountCaptured: { amountMinor: 349900, currency: 'INR' },
        amountRefunded: { amountMinor: 0, currency: 'INR' },
        remainingRefundable: { amountMinor: 349900, currency: 'INR' },
        currency: 'INR',
        paymentIntentId: 'pi_1S',
        invoiceId: 'in_1S',
        customerId: 'cus_014',
        created: AT_S,
        refunded: false,
      }),
    previewChange: () => Promise.reject(new Error('unused')),
    createRefund: (input, idempotencyKey) => {
      const existing = refunds.get(idempotencyKey);
      if (existing) return Promise.resolve(existing);
      creations += 1;
      const record: RefundRecord = {
        id: `re_${creations}`,
        status: 'succeeded',
        amount: { amountMinor: input.amountMinor, currency: 'INR' },
        chargeId: input.chargeId ?? null,
        paymentIntentId: 'pi_1S',
        reason: input.reason,
        created: AT_S,
      };
      refunds.set(idempotencyKey, record);
      return Promise.resolve(record);
    },
    cancelSubscription: (input) =>
      Promise.resolve({
        id: input.subscriptionId,
        status: 'active',
        customerId: 'cus_014',
        items: [],
        currentPeriodEnd: AT_S,
        cancelAtPeriodEnd: true,
        canceledAt: null,
        cancelAt: null,
        latestInvoiceId: 'in_1S',
        collectionMethod: 'charge_automatically',
      }),
    changePlan: () => Promise.reject(new Error('unused')),
    getRefund: (id) => {
      const found = [...refunds.values()].find((r) => r.id === id);
      if (!found) return Promise.reject(new Error('missing'));
      return Promise.resolve(found);
    },
  };
  return { provider, creations: () => creations };
}

afterEach(() => setBillingProvider(null));

describe('idempotency claim key', () => {
  it('two identical refund requests share one key, so Stripe returns the original', () => {
    const input = {
      subscriptionId: 'sub_1S',
      invoiceId: 'in_1S',
      amountMinor: 349900,
      reason: 'requested_by_customer',
    };
    expect(keyFor('create_refund', 1, input)).toBe(keyFor('create_refund', 1, { ...input }));
  });

  it('two identical create_refund calls produce exactly one refund', async () => {
    const { provider, creations } = stripeLikeProvider();
    setBillingProvider(provider);
    const input = {
      subscriptionId: 'sub_1S',
      invoiceId: 'in_1S',
      amountMinor: 349900,
      reason: 'requested_by_customer' as const,
    };
    const key = keyFor('create_refund', 1, input);
    const [first, second] = await Promise.all([
      createRefund.execute(input, ctxFor(key)),
      createRefund.execute(input, ctxFor(key)),
    ]);
    expect(creations()).toBe(1);
    expect(second).toEqual(first);
  });

  it('passes the claim key through as the Stripe idempotency key on every write', async () => {
    const seen: string[] = [];
    const { provider } = stripeLikeProvider();
    const capturing: BillingProvider = {
      ...provider,
      cancelSubscription: (input, idempotencyKey) => {
        seen.push(idempotencyKey);
        return provider.cancelSubscription(input, idempotencyKey);
      },
      createRefund: (input, idempotencyKey) => {
        seen.push(idempotencyKey);
        return provider.createRefund(input, idempotencyKey);
      },
    };
    setBillingProvider(capturing);

    const refundKey = keyFor('create_refund', 1, {
      subscriptionId: 'sub_1S',
      invoiceId: 'in_1S',
      amountMinor: 100,
      reason: 'duplicate',
    });
    await createRefund.execute(
      { subscriptionId: 'sub_1S', invoiceId: 'in_1S', amountMinor: 100, reason: 'duplicate' },
      ctxFor(refundKey),
    );
    const cancelKey = keyFor('cancel_subscription', 1, {
      subscriptionId: 'sub_1S',
      mode: 'at_period_end',
    });
    await cancelSubscription.execute(
      { subscriptionId: 'sub_1S', mode: 'at_period_end' },
      ctxFor(cancelKey),
    );
    expect(seen).toEqual([refundKey, cancelKey]);
    expect(changePlan.idempotent).toBe(true);
  });
});

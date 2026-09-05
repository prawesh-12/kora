import { ToolError } from '@kora/core';
import { describe, expect, it } from 'vitest';
import type {
  BillingProvider,
  SubscriptionItemRecord,
  SubscriptionRecord,
} from '../src/billing/types.js';
import { verifyCancelSubscription, verifyChangePlan, verifyRefund } from '../src/verify.js';

const AT_S = Math.floor(Date.parse('2026-08-27T12:00:00.000Z') / 1000);
const DAY_S = 86_400;

const baseItem: SubscriptionItemRecord = {
  subscriptionItemId: 'si_1S',
  priceId: 'price_A',
  productId: 'prod_A',
  unitAmount: { amountMinor: 349900, currency: 'INR' },
  quantity: 1,
};

const baseSubscription: SubscriptionRecord = {
  id: 'sub_1S',
  status: 'active' as const,
  customerId: 'cus_014',
  items: [baseItem],
  currentPeriodEnd: AT_S + 26 * DAY_S,
  cancelAtPeriodEnd: false,
  canceledAt: null as number | null,
  cancelAt: null as number | null,
  latestInvoiceId: 'in_1S',
  collectionMethod: 'charge_automatically',
};

const baseInvoice = {
  id: 'in_1S',
  status: 'paid' as const,
  customerId: 'cus_014',
  subscriptionId: 'sub_1S',
  amountDue: { amountMinor: 5000, currency: 'INR' },
  amountPaid: { amountMinor: 5000, currency: 'INR' },
  amountRemaining: { amountMinor: 0, currency: 'INR' },
  paymentIntentId: 'pi_1S',
  chargeId: 'ch_1S',
  created: AT_S,
};

function succeededRefund(amountMinor: number) {
  return {
    id: 're_1S',
    status: 'succeeded' as const,
    amount: { amountMinor, currency: 'INR' },
    chargeId: 'ch_1S',
    paymentIntentId: 'pi_1S',
    reason: 'requested_by_customer',
    created: AT_S,
  };
}

function stubProvider(overrides: Partial<BillingProvider> = {}): BillingProvider {
  return {
    getCustomer: () => {
      throw new ToolError('not wired', { code: 'CONFIG_ERROR' });
    },
    getSubscription: () => Promise.resolve({ ...baseSubscription }),
    getInvoice: () => Promise.resolve({ ...baseInvoice }),
    resolveChargeForInvoice: () => Promise.resolve(null),
    previewChange: () =>
      Promise.resolve({
        lines: [],
        prorationCreditMinor: 12000,
        nextChargeMinor: 5000,
        currency: 'INR',
      }),
    createRefund: () => {
      throw new ToolError('not wired', { code: 'CONFIG_ERROR' });
    },
    cancelSubscription: () => Promise.resolve({ ...baseSubscription }),
    changePlan: () => Promise.resolve({ ...baseSubscription }),
    getRefund: () => Promise.resolve(succeededRefund(349900)),
    ...overrides,
  };
}

function notFound(): Promise<never> {
  throw new ToolError('no such refund', { code: 'UPSTREAM_4XX' });
}

describe('verifyRefund', () => {
  const input = { amountMinor: 349900 };
  const output = { id: 're_1S', amountMinor: 349900, currency: 'INR' };

  it('passes on a real success with matching amount and currency', async () => {
    const result = await verifyRefund(stubProvider(), input, output);
    expect(result.verified).toBe(true);
  });

  it('fails on an injected amount mismatch', async () => {
    const provider = stubProvider({ getRefund: () => Promise.resolve(succeededRefund(100000)) });
    const result = await verifyRefund(provider, input, output);
    expect(result).toMatchObject({ verified: false, reason: 'amount_mismatch' });
  });

  it('never claims success on pending or requires_action', async () => {
    for (const status of ['pending', 'requires_action'] as const) {
      const provider = stubProvider({
        getRefund: () => Promise.resolve({ ...succeededRefund(349900), status }),
      });
      const result = await verifyRefund(provider, input, output);
      expect(result, status).toMatchObject({ verified: false, reason: 'refund_pending' });
    }
  });

  it('fails on failed or canceled refunds', async () => {
    for (const status of ['failed', 'canceled'] as const) {
      const provider = stubProvider({
        getRefund: () => Promise.resolve({ ...succeededRefund(349900), status }),
      });
      const result = await verifyRefund(provider, input, output);
      expect(result, status).toMatchObject({ verified: false, reason: `refund_${status}` });
    }
  });

  it('fails when the refund cannot be read back', async () => {
    const result = await verifyRefund(stubProvider({ getRefund: notFound }), input, output);
    expect(result).toMatchObject({ verified: false, reason: 'refund_not_found' });
  });
});

describe('verifyCancelSubscription', () => {
  it('passes an immediate cancel read back as canceled with a timestamp', async () => {
    const provider = stubProvider({
      getSubscription: () =>
        Promise.resolve({ ...baseSubscription, status: 'canceled', canceledAt: AT_S }),
    });
    const result = await verifyCancelSubscription(
      provider,
      { subscriptionId: 'sub_1S', mode: 'immediate' },
      { subscriptionId: 'sub_1S' },
    );
    expect(result.verified).toBe(true);
  });

  it('fails an immediate cancel that is still active', async () => {
    const result = await verifyCancelSubscription(
      stubProvider(),
      { subscriptionId: 'sub_1S', mode: 'immediate' },
      { subscriptionId: 'sub_1S' },
    );
    expect(result).toMatchObject({ verified: false, reason: 'subscription_still_active' });
  });

  it('passes at_period_end with the flag set and records the stop date', async () => {
    const provider = stubProvider({
      getSubscription: () => Promise.resolve({ ...baseSubscription, cancelAtPeriodEnd: true }),
    });
    const result = await verifyCancelSubscription(
      provider,
      { subscriptionId: 'sub_1S', mode: 'at_period_end' },
      { subscriptionId: 'sub_1S' },
    );
    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.observed).toMatchObject({ effectiveStop: AT_S + 26 * DAY_S });
    }
  });

  it('fails at_period_end when the flag did not land', async () => {
    const result = await verifyCancelSubscription(
      stubProvider(),
      { subscriptionId: 'sub_1S', mode: 'at_period_end' },
      { subscriptionId: 'sub_1S' },
    );
    expect(result).toMatchObject({ verified: false, reason: 'cancel_at_period_end_not_set' });
  });
});

describe('verifyChangePlan', () => {
  const input = {
    subscriptionId: 'sub_1S',
    subscriptionItemId: 'si_1S',
    targetPriceId: 'price_B',
    prorationBehavior: 'create_prorations',
  };

  it('passes when the item now carries the target price and proration matches', async () => {
    const provider = stubProvider({
      getSubscription: () =>
        Promise.resolve({
          ...baseSubscription,
          items: [{ ...baseItem, priceId: 'price_B' }],
        }),
    });
    const result = await verifyChangePlan(provider, input, { subscriptionId: 'sub_1S' }, 5000);
    expect(result.verified).toBe(true);
  });

  it('fails on an unchanged price', async () => {
    const result = await verifyChangePlan(stubProvider(), input, { subscriptionId: 'sub_1S' });
    expect(result).toMatchObject({ verified: false, reason: 'price_not_changed' });
  });

  it('fails when the created proration drifts from the quote', async () => {
    const provider = stubProvider({
      getSubscription: () =>
        Promise.resolve({
          ...baseSubscription,
          items: [{ ...baseItem, priceId: 'price_B' }],
        }),
      getInvoice: () =>
        Promise.resolve({
          ...baseInvoice,
          amountDue: { amountMinor: 99999, currency: 'INR' },
          amountPaid: { amountMinor: 99999, currency: 'INR' },
        }),
    });
    const result = await verifyChangePlan(provider, input, { subscriptionId: 'sub_1S' }, 5000);
    expect(result).toMatchObject({ verified: false, reason: 'proration_mismatch' });
  });
});

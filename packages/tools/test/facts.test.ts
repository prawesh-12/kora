import { describe, expect, it } from 'vitest';
import { buildFacts } from '../src/facts.js';
import type { SubscriptionItemRecord, SubscriptionRecord } from '../src/billing/types.js';
import type { GatheredContext } from '../src/types.js';

const AT = new Date('2026-08-27T12:00:00.000Z');
const AT_S = Math.floor(AT.getTime() / 1000);
const DAY_S = 86_400;

const baseItem: SubscriptionItemRecord = {
  subscriptionItemId: 'si_1S',
  priceId: 'price_A',
  productId: 'prod_A',
  unitAmount: { amountMinor: 349900, currency: 'INR' },
  quantity: 1,
};

const subscription: SubscriptionRecord = {
  id: 'sub_1S',
  status: 'active' as const,
  customerId: 'cus_014',
  items: [baseItem],
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
  created: AT_S - 4 * DAY_S,
  refunded: false,
};

const gathered: GatheredContext = { subscription, charge };

describe('billing facts', () => {
  it('derives every refund fact from the records', () => {
    expect(buildFacts('create_refund', gathered, AT, { amountMinor: 200000 })).toMatchObject({
      action: 'create_refund',
      channel: 'web',
      currency: 'INR',
      subscriptionStatus: 'active',
      cancelAtPeriodEnd: false,
      currentPlanPriceId: 'price_A',
      amountMinor: 200000,
      remainingRefundableMinor: 249900,
      exceedsRefundable: false,
      daysSinceCharge: 4,
    });
  });

  it('flags a request above the remaining refundable amount', () => {
    const facts = buildFacts('create_refund', gathered, AT, { amountMinor: 249901 });
    expect(facts.exceedsRefundable).toBe(true);
    expect(facts.remainingRefundableMinor).toBe(249900);
  });

  it('records charge facts as missing when no charge was resolved, so no rule matches on them', () => {
    const facts = buildFacts('create_refund', { subscription }, AT, { amountMinor: 100 });
    expect(facts.remainingRefundableMinor).toBeUndefined();
    expect(facts.exceedsRefundable).toBeUndefined();
    expect(facts.daysSinceCharge).toBeUndefined();
    expect(facts.amountMinor).toBe(100);
    expect(facts.currency).toBe('INR');
  });

  it('omits the requested amount when the input does not carry a positive integer', () => {
    for (const amountMinor of [undefined, '200000', 1.5, 0, -50, null]) {
      const facts = buildFacts('create_refund', gathered, AT, { amountMinor });
      expect(facts.amountMinor).toBeUndefined();
      expect(facts.exceedsRefundable).toBeUndefined();
    }
  });

  it('never lets the customer message move a record-derived fact', () => {
    const facts = buildFacts('create_refund', gathered, AT, {
      amountMinor: 99_999_999,
      messageAmount: 349900,
      claimedTotal: 1,
    });
    expect(facts.remainingRefundableMinor).toBe(249900);
    expect(facts.exceedsRefundable).toBe(true);
    expect(facts).not.toHaveProperty('messageAmount');
    expect(facts).not.toHaveProperty('claimedTotal');
  });

  it('picks the targeted item for the current plan price', () => {
    const twoItems = {
      ...subscription,
      items: [
        baseItem,
        {
          subscriptionItemId: 'si_2S',
          priceId: 'price_B',
          productId: 'prod_B',
          unitAmount: { amountMinor: 899900, currency: 'INR' },
          quantity: 1,
        },
      ],
    };
    const facts = buildFacts('change_plan', { subscription: twoItems }, AT, {
      subscriptionItemId: 'si_2S',
      targetPriceId: 'price_C',
    });
    expect(facts.currentPlanPriceId).toBe('price_B');
    expect(facts.targetPlanPriceId).toBe('price_C');
  });

  it('takes the proration credit from the preview record', () => {
    const facts = buildFacts(
      'change_plan',
      {
        subscription,
        preview: { lines: [], prorationCreditMinor: 12000, nextChargeMinor: 5000, currency: 'INR' },
      },
      AT,
      { subscriptionItemId: 'si_1S', targetPriceId: 'price_B' },
    );
    expect(facts.prorationCreditMinor).toBe(12000);
  });

  it('carries no billing facts at all when nothing was fetched', () => {
    expect(buildFacts('create_refund', {}, AT)).toEqual({
      action: 'create_refund',
      channel: 'web',
    });
  });
});

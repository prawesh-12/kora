import { describe, expect, it } from 'vitest';
import { buildFacts } from '../src/facts.js';

const AT = new Date('2026-08-27T12:00:00.000Z');

const order = {
  id: '9832',
  customerId: 'cus_014',
  status: 'delivered',
  items: [{ sku: 'SKU-CM-01', category: 'appliance', quantity: 1, unitAmountMinor: 349900 }],
  totalAmountMinor: 349900,
  currency: 'INR',
  deliveredAt: '2026-08-23T12:00:00.000Z',
  replacementIds: [] as string[],
};

describe('buildFacts', () => {
  it('derives every fact from the order record', () => {
    expect(buildFacts('create_replacement', { order }, AT)).toMatchObject({
      action: 'create_replacement',
      channel: 'web',
      orderStatus: 'delivered',
      amountMinor: 349900,
      currency: 'INR',
      itemCategory: 'appliance',
      daysSinceDelivery: 4,
      alreadyReplaced: false,
    });
  });

  it('marks an order that already has a replacement', () => {
    const facts = buildFacts(
      'create_replacement',
      { order: { ...order, replacementIds: ['REP-0001'] } },
      AT,
    );
    expect(facts.alreadyReplaced).toBe(true);
  });

  it('omits daysSinceDelivery for an undelivered order rather than guessing zero', () => {
    const facts = buildFacts(
      'create_replacement',
      { order: { ...order, status: 'shipped', deliveredAt: null } },
      AT,
    );
    expect(facts.daysSinceDelivery).toBeUndefined();
    expect(facts.orderStatus).toBe('shipped');
  });

  it('carries no order facts at all when no order was fetched', () => {
    const facts = buildFacts('create_replacement', {}, AT);
    expect(facts).toEqual({ action: 'create_replacement', channel: 'web' });
  });

  it('ignores anything the model might have claimed, because it takes nothing but the record', () => {
    const facts = buildFacts(
      'create_replacement',
      { order: { ...order, deliveredAt: '2026-08-15T12:00:00.000Z' } },
      AT,
    );
    expect(facts.daysSinceDelivery).toBe(12);
  });
});

describe('refund facts', () => {
  const refundOrder = { ...order, totalAmountMinor: 349900 };

  it('derives the remaining balance from the order and what is already refunded', () => {
    const facts = buildFacts(
      'create_refund',
      { order: refundOrder, refundedAmountMinor: 100000 },
      AT,
      { amountMinor: 200000 },
    );
    expect(facts).toMatchObject({
      orderTotalMinor: 349900,
      refundedAmountMinor: 100000,
      requestedAmountMinor: 200000,
      fullyRefunded: false,
      exceedsRemaining: false,
    });
  });

  it('flags a request for more than what is left', () => {
    const facts = buildFacts(
      'create_refund',
      { order: refundOrder, refundedAmountMinor: 300000 },
      AT,
      { amountMinor: 100000 },
    );
    expect(facts.exceedsRemaining).toBe(true);
  });

  it('flags an order that is already fully refunded', () => {
    const facts = buildFacts(
      'create_refund',
      { order: refundOrder, refundedAmountMinor: 349900 },
      AT,
      { amountMinor: 1 },
    );
    expect(facts.fullyRefunded).toBe(true);
  });

  it('omits the requested amount when the input does not carry an integer', () => {
    for (const amountMinor of [undefined, '200000', 1.5, null]) {
      const facts = buildFacts('create_refund', { order: refundOrder }, AT, { amountMinor });
      expect(facts.requestedAmountMinor).toBeUndefined();
      expect(facts.exceedsRemaining).toBeUndefined();
    }
  });

  it('compares the requested amount against the record, never trusting it alone', () => {
    // The model could ask for anything. The comparison is what makes it safe.
    const facts = buildFacts('create_refund', { order: refundOrder }, AT, {
      amountMinor: 99_999_999,
    });
    expect(facts.exceedsRemaining).toBe(true);
    expect(facts.orderTotalMinor).toBe(349900);
  });
});

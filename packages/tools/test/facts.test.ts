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

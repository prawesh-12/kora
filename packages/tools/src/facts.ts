import type { Intent, PolicyFacts } from '@kora/core';
import type { GatheredContext } from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Every fact here comes from a tool result or a database row. Nothing comes from
 * model-generated text. If the customer says the item was delivered yesterday and
 * the order record says twelve days ago, the order wins, silently.
 */
export function buildFacts(action: string, gathered: GatheredContext, at: Date): PolicyFacts {
  const facts: PolicyFacts = { action, channel: 'web' };

  if (gathered.intent) facts.intent = gathered.intent as Intent;

  const order = gathered.order;
  if (!order) return facts;

  facts.orderStatus = order.status;
  facts.amountMinor = order.totalAmountMinor;
  facts.currency = order.currency;
  facts.alreadyReplaced = order.replacementIds.length > 0;

  const firstItem = order.items[0];
  if (firstItem) facts.itemCategory = firstItem.category;

  if (order.deliveredAt) {
    const deliveredAt = new Date(order.deliveredAt).getTime();
    if (Number.isFinite(deliveredAt)) {
      facts.daysSinceDelivery = Math.floor((at.getTime() - deliveredAt) / MS_PER_DAY);
    }
  }

  return facts;
}

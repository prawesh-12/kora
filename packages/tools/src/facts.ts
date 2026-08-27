import type { Intent, PolicyFacts } from '@kora/core';
import type { GatheredContext } from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Every fact here comes from a tool result or a database row. Nothing comes from
 * model-generated text. If the customer says the item was delivered yesterday and
 * the order record says twelve days ago, the order wins, silently.
 *
 * `proposedInput` is the exception that proves the rule: the requested refund
 * amount genuinely originates with the request. It is never trusted on its own —
 * every rule that uses it compares it against the order total, which does come
 * from the record.
 */
export function buildFacts(
  action: string,
  gathered: GatheredContext,
  at: Date,
  proposedInput?: unknown,
): PolicyFacts {
  const facts: PolicyFacts = { action, channel: 'web' };

  if (gathered.intent) facts.intent = gathered.intent as Intent;

  const order = gathered.order;
  if (!order) return facts;

  facts.orderStatus = order.status;
  facts.amountMinor = order.totalAmountMinor;
  facts.orderTotalMinor = order.totalAmountMinor;
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

  const refunded = gathered.refundedAmountMinor ?? 0;
  facts.refundedAmountMinor = refunded;
  facts.fullyRefunded = refunded >= order.totalAmountMinor;

  const requested = (proposedInput as { amountMinor?: unknown } | undefined)?.amountMinor;
  if (typeof requested === 'number' && Number.isInteger(requested)) {
    facts.requestedAmountMinor = requested;
    facts.exceedsRemaining = requested > order.totalAmountMinor - refunded;
  }

  return facts;
}

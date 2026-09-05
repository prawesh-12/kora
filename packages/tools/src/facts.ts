import type { Intent, PolicyFacts } from '@kora/core';
import type { GatheredContext } from './types.js';

const SECONDS_PER_DAY = 86_400;

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function buildFacts(
  action: string,
  gathered: GatheredContext,
  at: Date,
  proposedInput?: unknown,
): PolicyFacts {
  const facts: PolicyFacts = { action, channel: 'web' };

  if (gathered.intent) facts.intent = gathered.intent as Intent;

  const input = (proposedInput ?? {}) as Record<string, unknown>;
  const subscription = gathered.subscription;
  const charge = gathered.charge;
  const preview = gathered.preview;

  if (subscription) {
    facts.subscriptionStatus = subscription.status;
    facts.cancelAtPeriodEnd = subscription.cancelAtPeriodEnd;

    const targetedItemId = input.subscriptionItemId;
    const targeted =
      typeof targetedItemId === 'string'
        ? subscription.items.find((item) => item.subscriptionItemId === targetedItemId)
        : undefined;
    const current =
      targeted ?? (subscription.items.length === 1 ? subscription.items[0] : undefined);
    if (current) facts.currentPlanPriceId = current.priceId;
  }

  if (charge) {
    facts.currency = charge.currency;
    facts.remainingRefundableMinor = charge.remainingRefundable.amountMinor;
    if (Number.isFinite(charge.created)) {
      facts.daysSinceCharge = Math.floor((at.getTime() / 1000 - charge.created) / SECONDS_PER_DAY);
    }
  } else if (subscription?.items[0]) {
    facts.currency = subscription.items[0].unitAmount.currency;
  }

  if (isPositiveInt(input.amountMinor)) {
    facts.amountMinor = input.amountMinor;
    if (typeof facts.remainingRefundableMinor === 'number') {
      facts.exceedsRefundable = input.amountMinor > facts.remainingRefundableMinor;
    }
  }

  if (typeof input.targetPriceId === 'string' && input.targetPriceId.length > 0) {
    facts.targetPlanPriceId = input.targetPriceId;
  }

  if (preview && Number.isInteger(preview.prorationCreditMinor)) {
    facts.prorationCreditMinor = preview.prorationCreditMinor;
  }

  return facts;
}

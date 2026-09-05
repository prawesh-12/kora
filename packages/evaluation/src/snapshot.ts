import { logger, now } from '@kora/core';
import type { AssembledTrace } from '@kora/db';
import { billingProvider } from '@kora/tools';
import type { RefundRecord, SubscriptionRecord } from './deps.js';
import type { ExternalStateSnapshot } from './types.js';

/**
 * Read back after the run finishes: the transcript says what the agent said, the
 * billing provider says what actually happened.
 */
export async function snapshotExternalState(args: {
  tenantId: string;
  trace: AssembledTrace;
}): Promise<ExternalStateSnapshot> {
  const refundIds = new Set<string>();
  const subscriptionIds = new Set<string>();

  for (const execution of args.trace.toolExecutions) {
    const input = execution.input as { subscriptionId?: string } | null;
    if (input?.subscriptionId) subscriptionIds.add(input.subscriptionId);

    const output = execution.output as {
      refundId?: string;
      id?: string;
      subscription?: { id?: string };
    } | null;
    if (output?.refundId) refundIds.add(output.refundId);
    if (output?.subscription?.id) subscriptionIds.add(output.subscription.id);
    // `cancel_subscription` returns the subscription itself, `create_ticket` a
    // ticket. Only the Stripe prefix says which one this is.
    if (output?.id?.startsWith('sub_')) subscriptionIds.add(output.id);
  }

  const refunds: Record<string, RefundRecord> = {};
  const subscriptions: Record<string, SubscriptionRecord> = {};

  try {
    const provider = billingProvider(args.tenantId);
    for (const id of refundIds) refunds[id] = await provider.getRefund(id);
    for (const id of subscriptionIds) subscriptions[id] = await provider.getSubscription(id);
  } catch (e) {
    logger().warn({ err: e }, 'external state snapshot failed');
    return { refunds, subscriptions, fetchedAt: now(), error: (e as Error).message };
  }

  return { refunds, subscriptions, fetchedAt: now() };
}

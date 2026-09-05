import type { BillingProvider } from './billing/types.js';
import { acme } from './clients/acme.js';
import type { ToolContext, ToolDefinition, VerifyResult } from './types.js';

export async function runVerification(
  tool: ToolDefinition,
  input: unknown,
  output: unknown,
  ctx: ToolContext,
): Promise<VerifyResult> {
  if (!tool.verify) return { verified: true, observed: null };
  try {
    return await tool.verify(input, output, ctx);
  } catch (e) {
    const timedOut = (e as Error).name === 'AbortError' || ctx.signal.aborted;
    return {
      verified: false,
      observed: null,
      reason: timedOut ? 'verification_timeout' : `verification_error: ${(e as Error).message}`,
    };
  }
}

function isNotFound(e: unknown): boolean {
  return (e as { code?: string }).code === 'UPSTREAM_4XX';
}

export async function verifyRefund(
  provider: BillingProvider,
  input: { amountMinor: number },
  output: { id: string; amountMinor: number; currency: string },
): Promise<VerifyResult> {
  let observed: unknown = null;
  try {
    observed = await provider.getRefund(output.id);
  } catch (e) {
    if (isNotFound(e)) return { verified: false, observed: null, reason: 'refund_not_found' };
    throw e;
  }

  const refund = observed as {
    status: string;
    amount: { amountMinor: number; currency: string };
  };
  if (refund.status === 'pending' || refund.status === 'requires_action') {
    return { verified: false, observed, reason: 'refund_pending' };
  }
  if (refund.status === 'failed' || refund.status === 'canceled') {
    return { verified: false, observed, reason: `refund_${refund.status}` };
  }
  if (refund.status !== 'succeeded') {
    return { verified: false, observed, reason: `unexpected_status_${refund.status}` };
  }
  if (
    refund.amount.amountMinor !== input.amountMinor ||
    refund.amount.amountMinor !== output.amountMinor
  ) {
    return { verified: false, observed, reason: 'amount_mismatch' };
  }
  if (refund.amount.currency !== output.currency) {
    return { verified: false, observed, reason: 'currency_mismatch' };
  }
  return { verified: true, observed };
}

export async function verifyCancelSubscription(
  provider: BillingProvider,
  input: { subscriptionId: string; mode: 'at_period_end' | 'immediate' },
  output: { subscriptionId: string },
): Promise<VerifyResult> {
  let observed: unknown = null;
  try {
    observed = await provider.getSubscription(output.subscriptionId);
  } catch (e) {
    if (isNotFound(e)) return { verified: false, observed: null, reason: 'subscription_not_found' };
    throw e;
  }

  const subscription = observed as {
    id: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    canceledAt: number | null;
    cancelAt: number | null;
    currentPeriodEnd: number | null;
  };
  if (subscription.id !== input.subscriptionId) {
    return { verified: false, observed, reason: 'subscription_mismatch' };
  }

  if (input.mode === 'immediate') {
    if (subscription.status !== 'canceled' || subscription.canceledAt == null) {
      return { verified: false, observed, reason: `subscription_still_${subscription.status}` };
    }
    return { verified: true, observed };
  }

  if (
    subscription.cancelAtPeriodEnd !== true ||
    subscription.status !== 'active' ||
    (subscription.cancelAt == null && subscription.currentPeriodEnd == null)
  ) {
    return { verified: false, observed, reason: 'cancel_at_period_end_not_set' };
  }
  const effectiveStop = subscription.cancelAt ?? subscription.currentPeriodEnd;
  return { verified: true, observed: { subscription: observed, effectiveStop } };
}

export async function verifyChangePlan(
  provider: BillingProvider,
  input: {
    subscriptionId: string;
    subscriptionItemId: string;
    targetPriceId: string;
    prorationBehavior: string;
  },
  output: { subscriptionId: string },
  quotedNextChargeMinor?: number | undefined,
): Promise<VerifyResult> {
  let observed: unknown = null;
  try {
    observed = await provider.getSubscription(output.subscriptionId);
  } catch (e) {
    if (isNotFound(e)) return { verified: false, observed: null, reason: 'subscription_not_found' };
    throw e;
  }

  const subscription = observed as {
    id: string;
    items: Array<{ subscriptionItemId: string; priceId: string }>;
    latestInvoiceId: string | null;
  };
  if (subscription.id !== input.subscriptionId) {
    return { verified: false, observed, reason: 'subscription_mismatch' };
  }
  const item = subscription.items.find((i) => i.subscriptionItemId === input.subscriptionItemId);
  if (!item || item.priceId !== input.targetPriceId) {
    return { verified: false, observed, reason: 'price_not_changed' };
  }

  if (
    quotedNextChargeMinor !== undefined &&
    input.prorationBehavior !== 'none' &&
    subscription.latestInvoiceId
  ) {
    const invoice = await provider.getInvoice(subscription.latestInvoiceId);
    const created = invoice.amountDue.amountMinor;
    if (Math.abs(created - quotedNextChargeMinor) > 1) {
      return {
        verified: false,
        observed: { subscription: observed, invoice, quotedNextChargeMinor },
        reason: 'proration_mismatch',
      };
    }
    return { verified: true, observed: { subscription: observed, invoice } };
  }

  return { verified: true, observed };
}

export async function verifyTicket(
  _input: unknown,
  output: { id: string },
  ctx: ToolContext,
): Promise<VerifyResult> {
  try {
    return {
      verified: true,
      observed: await acme.getTicket(output.id, { signal: ctx.signal, fault: ctx.fault }),
    };
  } catch (e) {
    if (isNotFound(e)) {
      return { verified: false, observed: null, reason: 'ticket_not_found' };
    }
    throw e;
  }
}

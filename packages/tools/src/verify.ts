import { acme } from './clients/acme.js';
import type { ToolContext, ToolDefinition, VerifyResult } from './types.js';

/**
 * A verify that itself errors is treated exactly like `verified: false`.
 * Ambiguity resolves toward a human, always.
 */
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

export async function verifyReplacement(
  input: { orderId: string },
  output: { id: string },
  ctx: ToolContext,
): Promise<VerifyResult> {
  const opts = { signal: ctx.signal, fault: ctx.fault };

  let observed: unknown = null;
  try {
    observed = await acme.getReplacement(output.id, opts);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'UPSTREAM_4XX') {
      return { verified: false, observed: null, reason: 'replacement_not_found' };
    }
    throw e;
  }

  const replacement = observed as { orderId: string; status: string };
  if (replacement.orderId !== input.orderId) {
    return { verified: false, observed, reason: 'order_mismatch' };
  }
  if (replacement.status !== 'created' && replacement.status !== 'processing') {
    return { verified: false, observed, reason: `unexpected_status_${replacement.status}` };
  }

  const forOrder = await acme.listReplacements(input.orderId, opts);
  if (forOrder.length !== 1) {
    return {
      verified: false,
      observed: { replacement: observed, forOrder },
      reason: forOrder.length === 0 ? 'replacement_not_found' : 'duplicate_detected',
    };
  }

  return { verified: true, observed: { replacement: observed, forOrder } };
}

/**
 * A partial refund at the wrong amount is a silent money bug, so the amount is
 * checked against the read-back, not just the presence of a refund.
 */
export async function verifyRefund(
  input: { orderId: string; amountMinor: number },
  output: { id: string },
  ctx: ToolContext,
): Promise<VerifyResult> {
  const opts = { signal: ctx.signal, fault: ctx.fault };

  let observed: unknown = null;
  try {
    observed = await acme.getRefund(output.id, opts);
  } catch (e) {
    if ((e as { code?: string }).code === 'UPSTREAM_4XX') {
      return { verified: false, observed: null, reason: 'refund_not_found' };
    }
    throw e;
  }

  const refund = observed as { orderId: string; amountMinor: number; status: string };
  if (refund.orderId !== input.orderId) {
    return { verified: false, observed, reason: 'order_mismatch' };
  }
  if (refund.amountMinor !== input.amountMinor) {
    return { verified: false, observed, reason: 'amount_mismatch' };
  }
  if (!['created', 'processing', 'settled'].includes(refund.status)) {
    return { verified: false, observed, reason: `unexpected_status_${refund.status}` };
  }

  const forOrder = await acme.listRefunds(input.orderId, opts);
  if (!forOrder.some((r) => r.id === output.id)) {
    return {
      verified: false,
      observed: { refund: observed, forOrder },
      reason: 'refund_not_found',
    };
  }

  return { verified: true, observed: { refund: observed, forOrder } };
}

export async function verifyCancellation(
  input: { orderId: string },
  output: { id: string },
  ctx: ToolContext,
): Promise<VerifyResult> {
  const opts = { signal: ctx.signal, fault: ctx.fault };

  // The cancellation record is not the point. The order actually being cancelled
  // is, so that is what gets checked first and what a failure reports.
  const order = await acme.getOrder(input.orderId, opts);
  if (order.status !== 'cancelled') {
    return { verified: false, observed: { order }, reason: `order_still_${order.status}` };
  }

  let cancellation: unknown = null;
  try {
    cancellation = await acme.getCancellation(output.id, opts);
  } catch (e) {
    if ((e as { code?: string }).code === 'UPSTREAM_4XX') {
      return { verified: false, observed: { order }, reason: 'cancellation_not_found' };
    }
    throw e;
  }

  if ((cancellation as { orderId: string }).orderId !== input.orderId) {
    return { verified: false, observed: { cancellation, order }, reason: 'order_mismatch' };
  }

  return { verified: true, observed: { cancellation, order } };
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
    if ((e as { code?: string }).code === 'UPSTREAM_4XX') {
      return { verified: false, observed: null, reason: 'ticket_not_found' };
    }
    throw e;
  }
}

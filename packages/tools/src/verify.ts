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

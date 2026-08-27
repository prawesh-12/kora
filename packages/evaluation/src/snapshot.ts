import { logger, now } from '@kora/core';
import type { AssembledTrace } from '@kora/db';
import { type OrderResponse, type ReplacementResponse, acmeReader } from '@kora/tools';
import type { ExternalStateSnapshot } from './types.js';

/**
 * Reads the affected entities back out of Acme after a run has finished.
 *
 * This is the part most teams skip and it is the whole point: the transcript tells
 * you what the agent said, the business system tells you what actually happened.
 */
export async function snapshotExternalState(args: {
  trace: AssembledTrace;
  extraOrderIds?: string[];
}): Promise<ExternalStateSnapshot> {
  const orderIds = new Set<string>(args.extraOrderIds ?? []);

  for (const execution of args.trace.toolExecutions) {
    const input = execution.input as { orderId?: string } | null;
    if (input?.orderId) orderIds.add(input.orderId);
    const output = execution.output as { orderId?: string; id?: string } | null;
    if (output?.orderId) orderIds.add(output.orderId);
  }

  const orders: Record<string, OrderResponse> = {};
  const replacementsByOrder: Record<string, ReplacementResponse[]> = {};

  try {
    for (const orderId of orderIds) {
      const order = await acmeReader.getOrderOrNull(orderId);
      if (order) orders[orderId] = order;
      replacementsByOrder[orderId] = await acmeReader.listReplacements(orderId);
    }
  } catch (e) {
    logger().warn({ err: e }, 'external state snapshot failed');
    return {
      orders,
      replacementsByOrder,
      fetchedAt: now(),
      error: (e as Error).message,
    };
  }

  return { orders, replacementsByOrder, fetchedAt: now() };
}

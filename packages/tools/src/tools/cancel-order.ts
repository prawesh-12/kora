import { z } from 'zod';
import { acme, cancellationSchema } from '../clients/acme.js';
import { defineTool } from '../registry.js';
import { verifyCancellation } from '../verify.js';

export const cancelOrder = defineTool({
  name: 'cancel_order',
  version: 1,
  description:
    'Use this when the customer wants an order stopped and the order has not shipped yet.',
  inputSchema: z.object({
    orderId: z.string().min(1),
    reason: z.enum(['customer_request', 'duplicate_order', 'address_problem']),
  }),
  outputSchema: cancellationSchema,
  sideEffect: 'write_high',
  requiredPermission: 'orders:write',
  timeoutMs: 10_000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { orderId: '9837', reason: 'customer_request' as const } }],
  execute: (input, ctx) =>
    acme.cancelOrder(
      { ...input, idempotencyKey: ctx.idempotencyKey },
      { signal: ctx.signal, fault: ctx.fault },
    ),
  verify: (input, output, ctx) => verifyCancellation(input, output, ctx),
});

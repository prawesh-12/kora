import { z } from 'zod';
import { acme, refundSchema } from '../clients/acme.js';
import { defineTool } from '../registry.js';
import { verifyRefund } from '../verify.js';

export const createRefund = defineTool({
  name: 'create_refund',
  version: 1,
  description:
    'Use this when the customer wants money back for a delivered order rather than a replacement, and the policy allows it.',
  inputSchema: z.object({
    orderId: z.string().min(1),
    amountMinor: z.number().int().positive(),
    reason: z.enum(['damaged', 'missing_item', 'wrong_item', 'not_as_described']),
  }),
  outputSchema: refundSchema,
  sideEffect: 'write_high',
  requiredPermission: 'payments:write',
  timeoutMs: 10_000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { orderId: '9832', amountMinor: 349900, reason: 'damaged' as const } }],
  execute: (input, ctx) =>
    acme.createRefund(
      { ...input, idempotencyKey: ctx.idempotencyKey },
      { signal: ctx.signal, fault: ctx.fault },
    ),
  verify: (input, output, ctx) => verifyRefund(input, output, ctx),
});

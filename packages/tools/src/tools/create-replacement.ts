import { z } from 'zod';
import { acme, replacementSchema } from '../clients/acme.js';
import { defineTool } from '../registry.js';
import { verifyReplacement } from '../verify.js';

export const createReplacement = defineTool({
  name: 'create_replacement',
  version: 1,
  description:
    'Use this when the customer has reported a damaged, missing or wrong item on a delivered order and the policy allows a replacement to be sent.',
  inputSchema: z.object({
    orderId: z.string().min(1),
    items: z
      .array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() }))
      .min(1),
    reason: z.enum(['damaged', 'missing_item', 'wrong_item']),
  }),
  outputSchema: replacementSchema,
  sideEffect: 'write_high',
  requiredPermission: 'orders:write',
  timeoutMs: 10_000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [
    {
      input: {
        orderId: '9832',
        items: [{ sku: 'SKU-CM-01', quantity: 1 }],
        reason: 'damaged' as const,
      },
    },
  ],
  execute: (input, ctx) =>
    acme.createReplacement(
      { ...input, idempotencyKey: ctx.idempotencyKey },
      { signal: ctx.signal, fault: ctx.fault },
    ),
  verify: (input, output, ctx) => verifyReplacement(input, output, ctx),
});

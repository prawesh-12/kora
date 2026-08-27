import { z } from 'zod';
import { acme, orderSchema } from '../clients/acme.js';
import { defineTool } from '../registry.js';

export const getOrder = defineTool({
  name: 'get_order',
  version: 1,
  description:
    'Use this when the customer mentions an order number and you need the real details of that order: what was bought, what it cost, and whether it has been delivered.',
  inputSchema: z.object({ orderId: z.string().min(1) }),
  outputSchema: orderSchema,
  sideEffect: 'read',
  requiredPermission: 'orders:read',
  timeoutMs: 4000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { orderId: '9832' } }],
  execute: (input, ctx) => acme.getOrder(input.orderId, { signal: ctx.signal, fault: ctx.fault }),
});

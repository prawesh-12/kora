import { z } from 'zod';
import { acme, customerSchema } from '../clients/acme.js';
import { defineTool } from '../registry.js';

export const getCustomer = defineTool({
  name: 'get_customer',
  version: 1,
  description:
    'Use this when you need to confirm who the customer is or which orders belong to them before acting on their behalf.',
  inputSchema: z.object({ customerId: z.string().min(1) }),
  outputSchema: customerSchema,
  sideEffect: 'read',
  requiredPermission: 'customers:read',
  timeoutMs: 4000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { customerId: 'cus_014' } }],
  execute: (input, ctx) =>
    acme.getCustomer(input.customerId, { signal: ctx.signal, fault: ctx.fault }),
});

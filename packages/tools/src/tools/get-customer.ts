import { z } from 'zod';
import { billingProvider } from '../billing/provider.js';
import { customerRecordSchema } from '../billing/schemas.js';
import { defineTool } from '../registry.js';

export const getCustomer = defineTool({
  name: 'get_customer',
  version: 1,
  description:
    'Use this when you need to confirm who the customer is and which payment method their subscription bills to before acting on their behalf.',
  inputSchema: z.object({ customerId: z.string().min(1) }),
  outputSchema: customerRecordSchema,
  sideEffect: 'read',
  requiredPermission: 'customers:read',
  timeoutMs: 4000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { customerId: 'cus_014' } }],
  execute: (input, ctx) => billingProvider(ctx.tenantId).getCustomer(input.customerId),
});

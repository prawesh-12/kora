import { z } from 'zod';
import { billingProvider } from '../billing/provider.js';
import { subscriptionRecordSchema } from '../billing/schemas.js';
import { defineTool } from '../registry.js';

export const getSubscription = defineTool({
  name: 'get_subscription',
  version: 1,
  description:
    'Use this when the customer mentions a subscription and you need its real state from the billing records: whether it is active, what plan it is on, and when the current period ends.',
  inputSchema: z.object({ subscriptionId: z.string().min(1) }),
  outputSchema: subscriptionRecordSchema,
  sideEffect: 'read',
  requiredPermission: 'subscriptions:read',
  timeoutMs: 4000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { subscriptionId: 'sub_1S' } }],
  execute: (input, ctx) => billingProvider(ctx.tenantId).getSubscription(input.subscriptionId),
});

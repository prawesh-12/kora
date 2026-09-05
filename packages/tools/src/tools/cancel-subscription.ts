import { z } from 'zod';
import { billingProvider } from '../billing/provider.js';
import { subscriptionRecordSchema } from '../billing/schemas.js';
import { defineTool } from '../registry.js';
import { verifyCancelSubscription } from '../verify.js';

export const cancelSubscription = defineTool({
  name: 'cancel_subscription',
  version: 1,
  description:
    'Use this when the customer wants their subscription stopped and the policy allows it. Immediate ends it now, at_period_end lets the paid period run out.',
  inputSchema: z.object({
    subscriptionId: z.string().min(1),
    mode: z.enum(['at_period_end', 'immediate']),
  }),
  outputSchema: subscriptionRecordSchema,
  sideEffect: 'write_high',
  requiredPermission: 'subscriptions:write',
  timeoutMs: 10_000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { subscriptionId: 'sub_1S', mode: 'at_period_end' as const } }],
  async execute(input, ctx) {
    const provider = billingProvider(ctx.tenantId);
    await provider.getSubscription(input.subscriptionId);
    return provider.cancelSubscription(input, ctx.idempotencyKey);
  },
  verify: (input, output, ctx) =>
    verifyCancelSubscription(
      billingProvider(ctx.tenantId),
      { subscriptionId: input.subscriptionId, mode: input.mode },
      { subscriptionId: output.id },
    ),
});

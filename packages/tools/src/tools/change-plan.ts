import { z } from 'zod';
import { billingProvider } from '../billing/provider.js';
import { invoicePreviewSchema, subscriptionRecordSchema } from '../billing/schemas.js';
import { defineTool } from '../registry.js';
import { verifyChangePlan } from '../verify.js';

export const changePlan = defineTool({
  name: 'change_plan',
  version: 1,
  description:
    'Use this when the customer wants a different plan and the policy allows it. The change is quoted first so the price is confirmed before anything moves.',
  inputSchema: z.object({
    subscriptionId: z.string().min(1),
    subscriptionItemId: z.string().min(1),
    targetPriceId: z.string().min(1),
    prorationBehavior: z.enum(['create_prorations', 'none', 'always_invoice']),
  }),
  outputSchema: z.object({
    subscription: subscriptionRecordSchema,
    quotedNextChargeMinor: z.number().int(),
  }),
  sideEffect: 'write_high',
  requiredPermission: 'subscriptions:write',
  timeoutMs: 10_000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [
    {
      input: {
        subscriptionId: 'sub_1S',
        subscriptionItemId: 'si_1S',
        targetPriceId: 'price_2S',
        prorationBehavior: 'create_prorations' as const,
      },
    },
  ],
  async execute(input, ctx) {
    const provider = billingProvider(ctx.tenantId);
    const preview = invoicePreviewSchema.parse(await provider.previewChange(input));
    const subscription = await provider.changePlan(input, ctx.idempotencyKey);
    return { subscription, quotedNextChargeMinor: preview.nextChargeMinor };
  },
  verify: (input, output, ctx) =>
    verifyChangePlan(
      billingProvider(ctx.tenantId),
      {
        subscriptionId: input.subscriptionId,
        subscriptionItemId: input.subscriptionItemId,
        targetPriceId: input.targetPriceId,
        prorationBehavior: input.prorationBehavior,
      },
      { subscriptionId: output.subscription.id },
      ctx.gathered.preview?.nextChargeMinor ?? output.quotedNextChargeMinor,
    ),
});

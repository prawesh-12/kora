import { z } from 'zod';
import { billingProvider } from '../billing/provider.js';
import { invoicePreviewSchema } from '../billing/schemas.js';
import { defineTool } from '../registry.js';

export const previewChange = defineTool({
  name: 'preview_change',
  version: 1,
  description:
    'Use this when the customer wants a different plan and you need to quote what the switch really costs, including any proration, before changing anything.',
  inputSchema: z.object({
    subscriptionId: z.string().min(1),
    subscriptionItemId: z.string().min(1),
    targetPriceId: z.string().min(1),
    prorationBehavior: z.enum(['create_prorations', 'none', 'always_invoice']),
  }),
  outputSchema: invoicePreviewSchema,
  sideEffect: 'read',
  requiredPermission: 'subscriptions:read',
  timeoutMs: 6000,
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
  execute: (input, _ctx) => billingProvider().previewChange(input),
});

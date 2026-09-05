import { z } from 'zod';

export const stripeFixtureManifestSchema = z.object({
  version: z.literal(1),
  backend: z.enum(['live', 'stub']),
  testClockId: z.string().min(1),
  frozenTime: z.string().min(1),
  refundWindowDays: z.number().int().positive(),
  priceIds: z.object({
    basic: z.string().min(1),
    pro: z.string().min(1),
  }),
  customers: z.array(
    z.object({
      key: z.string().min(1),
      id: z.string().min(1),
      email: z.string().min(1),
      paymentMethodId: z.string().min(1),
    }),
  ),
  subscriptions: z.array(
    z.object({
      key: z.string().min(1),
      id: z.string().min(1),
      customerId: z.string().min(1),
      priceId: z.string().min(1),
      status: z.string().min(1),
    }),
  ),
  charges: z.array(
    z.object({
      key: z.string().min(1),
      id: z.string().min(1),
      customerId: z.string().min(1),
      invoiceId: z.string().min(1),
      amountMinor: z.number().int().positive(),
      currency: z.string().min(1),
      createdAt: z.string().min(1),
    }),
  ),
});

export type StripeFixtureManifest = z.infer<typeof stripeFixtureManifestSchema>;

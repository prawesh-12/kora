import { z } from 'zod';

export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().min(1),
});

export const customerRecordSchema = z.object({
  id: z.string().min(1),
  email: z.string().nullable(),
  name: z.string().nullable(),
  defaultPaymentMethodId: z.string().nullable(),
  currency: z.string().nullable(),
});

export const subscriptionItemSchema = z.object({
  subscriptionItemId: z.string().min(1),
  priceId: z.string().min(1),
  productId: z.string(),
  unitAmount: moneySchema,
  quantity: z.number().int(),
});

export const subscriptionRecordSchema = z.object({
  id: z.string().min(1),
  status: z.enum([
    'active',
    'past_due',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'trialing',
    'unpaid',
    'paused',
  ]),
  customerId: z.string().min(1),
  items: z.array(subscriptionItemSchema),
  currentPeriodEnd: z.number().int().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.number().int().nullable(),
  cancelAt: z.number().int().nullable(),
  latestInvoiceId: z.string().nullable(),
  collectionMethod: z.string(),
});

export const invoiceRecordSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  customerId: z.string().min(1),
  subscriptionId: z.string().nullable(),
  amountDue: moneySchema,
  amountPaid: moneySchema,
  amountRemaining: moneySchema,
  paymentIntentId: z.string().nullable(),
  chargeId: z.string().nullable(),
  created: z.number().int(),
});

export const chargeRecordSchema = z.object({
  id: z.string().min(1),
  amountCaptured: moneySchema,
  amountRefunded: moneySchema,
  remainingRefundable: moneySchema,
  currency: z.string().min(1),
  paymentIntentId: z.string().nullable(),
  invoiceId: z.string().nullable(),
  customerId: z.string().nullable(),
  created: z.number().int(),
  refunded: z.boolean(),
});

export const refundRecordSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
  amount: moneySchema,
  chargeId: z.string().nullable(),
  paymentIntentId: z.string().nullable(),
  reason: z.string().nullable(),
  created: z.number().int(),
});

export const invoicePreviewSchema = z.object({
  lines: z.array(
    z.object({
      amountMinor: z.number().int(),
      description: z.string(),
      proration: z.boolean(),
    }),
  ),
  prorationCreditMinor: z.number().int(),
  nextChargeMinor: z.number().int(),
  currency: z.string().nullable(),
});

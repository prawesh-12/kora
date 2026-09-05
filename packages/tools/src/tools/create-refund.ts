import { ToolError } from '@kora/core';
import { z } from 'zod';
import { billingProvider } from '../billing/provider.js';
import { defineTool } from '../registry.js';
import { verifyRefund } from '../verify.js';

export const createRefund = defineTool({
  name: 'create_refund',
  version: 1,
  description:
    'Use this when the customer wants money back for a subscription payment and the policy allows it. The amount comes from the charge record, never from the message, and the refund is confirmed by reading it back.',
  inputSchema: z.object({
    subscriptionId: z.string().min(1),
    invoiceId: z.string().min(1).optional(),
    amountMinor: z.number().int().positive(),
    reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']),
  }),
  outputSchema: z.object({
    refundId: z.string().min(1),
    status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
    amountMinor: z.number().int(),
    currency: z.string().min(1),
  }),
  sideEffect: 'write_high',
  requiredPermission: 'payments:write',
  timeoutMs: 10_000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [
    {
      input: {
        subscriptionId: 'sub_1S',
        invoiceId: 'in_1S',
        amountMinor: 349900,
        reason: 'requested_by_customer' as const,
      },
    },
  ],
  async execute(input, ctx) {
    const provider = billingProvider();
    let invoiceId = input.invoiceId;
    if (!invoiceId) {
      const subscription = await provider.getSubscription(input.subscriptionId);
      if (!subscription.latestInvoiceId) {
        throw new ToolError(
          `subscription ${input.subscriptionId} has no latest invoice, so there is no charge to refund`,
          { code: 'INVALID_INPUT', retryable: false },
        );
      }
      invoiceId = subscription.latestInvoiceId;
    }
    const charge = await provider.resolveChargeForInvoice(invoiceId);
    if (!charge) {
      throw new ToolError(
        `invoice ${invoiceId} has no captured charge, so the refund cannot proceed`,
        { code: 'INVALID_INPUT', retryable: false },
      );
    }
    const refund = await provider.createRefund(
      { invoiceId, chargeId: charge.id, amountMinor: input.amountMinor, reason: input.reason },
      ctx.idempotencyKey,
    );
    return {
      refundId: refund.id,
      status: refund.status,
      amountMinor: refund.amount.amountMinor,
      currency: refund.amount.currency,
    };
  },
  verify: (input, output, _ctx) =>
    verifyRefund(
      billingProvider(),
      { amountMinor: input.amountMinor },
      { id: output.refundId, amountMinor: output.amountMinor, currency: output.currency },
    ),
});

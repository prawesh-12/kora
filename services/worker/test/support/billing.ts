import type {
  BillingProvider,
  ChargeRecord,
  InvoiceRecord,
  RefundInput,
  RefundRecord,
  SubscriptionRecord,
} from '@kora/tools';

const CURRENCY = 'INR';
const AMOUNT_MINOR = 349_900;

function money(amountMinor: number) {
  return { amountMinor, currency: CURRENCY };
}

/**
 * The smallest provider that lets one refund turn reach a verified resolution, so the
 * worker tests need no billing service. Refunds are keyed by idempotency key, so a
 * retry returns the first result.
 */
export function stubBilling(): BillingProvider {
  const refunds = new Map<string, RefundRecord>();
  const byKey = new Map<string, RefundRecord>();
  let issued = 0;

  const subscription: SubscriptionRecord = {
    id: 'sub_recent',
    status: 'active',
    customerId: 'cus_014',
    items: [
      {
        subscriptionItemId: 'si_recent',
        priceId: 'price_basic',
        productId: 'prod_basic',
        unitAmount: money(AMOUNT_MINOR),
        quantity: 1,
      },
    ],
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400 * 20,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelAt: null,
    latestInvoiceId: 'in_recent',
    collectionMethod: 'charge_automatically',
  };

  const invoice: InvoiceRecord = {
    id: 'in_recent',
    status: 'paid',
    customerId: 'cus_014',
    subscriptionId: 'sub_recent',
    amountDue: money(AMOUNT_MINOR),
    amountPaid: money(AMOUNT_MINOR),
    amountRemaining: money(0),
    paymentIntentId: 'pi_recent',
    chargeId: 'ch_recent',
    created: Math.floor(Date.now() / 1000) - 86_400 * 5,
  };

  const charge: ChargeRecord = {
    id: 'ch_recent',
    amountCaptured: money(AMOUNT_MINOR),
    amountRefunded: money(0),
    remainingRefundable: money(AMOUNT_MINOR),
    currency: CURRENCY,
    paymentIntentId: 'pi_recent',
    invoiceId: 'in_recent',
    customerId: 'cus_014',
    created: Math.floor(Date.now() / 1000) - 86_400 * 5,
    refunded: false,
  };

  return {
    getCustomer: async (id) => ({
      id,
      email: 'customer@example.com',
      name: 'Test Customer',
      defaultPaymentMethodId: 'pm_1',
      currency: CURRENCY,
    }),
    getSubscription: async () => ({ ...subscription }),
    getInvoice: async () => ({ ...invoice }),
    resolveChargeForInvoice: async () => ({ ...charge }),
    previewChange: async () => ({
      lines: [],
      prorationCreditMinor: 0,
      nextChargeMinor: 0,
      currency: CURRENCY,
    }),
    createRefund: async (input: RefundInput, idempotencyKey: string) => {
      const existing = byKey.get(idempotencyKey);
      if (existing) return { ...existing };
      issued += 1;
      const record: RefundRecord = {
        id: `re_worker_${issued}`,
        status: 'succeeded',
        amount: money(input.amountMinor),
        chargeId: charge.id,
        paymentIntentId: charge.paymentIntentId,
        reason: input.reason,
        created: Math.floor(Date.now() / 1000),
      };
      byKey.set(idempotencyKey, record);
      refunds.set(record.id, record);
      return { ...record };
    },
    cancelSubscription: async () => ({ ...subscription }),
    changePlan: async () => ({ ...subscription }),
    getRefund: async (id) => {
      const found = refunds.get(id);
      if (!found) throw new Error(`no such refund ${id}`);
      return { ...found };
    },
  };
}

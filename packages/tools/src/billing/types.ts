import type { Money } from '@kora/core';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'unpaid'
  | 'paused';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';

export type RefundStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';

export interface CustomerRecord {
  id: string;
  email: string | null;
  name: string | null;
  defaultPaymentMethodId: string | null;
  currency: string | null;
}

export interface SubscriptionItemRecord {
  subscriptionItemId: string;
  priceId: string;
  productId: string;
  unitAmount: Money;
  quantity: number;
}

export interface SubscriptionRecord {
  id: string;
  status: SubscriptionStatus;
  customerId: string;
  items: SubscriptionItemRecord[];
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  cancelAt: number | null;
  latestInvoiceId: string | null;
  collectionMethod: string;
}

export interface InvoiceRecord {
  id: string;
  status: InvoiceStatus;
  customerId: string;
  subscriptionId: string | null;
  amountDue: Money;
  amountPaid: Money;
  amountRemaining: Money;
  paymentIntentId: string | null;
  chargeId: string | null;
  created: number;
}

export interface ChargeRecord {
  id: string;
  amountCaptured: Money;
  amountRefunded: Money;
  remainingRefundable: Money;
  currency: string;
  paymentIntentId: string | null;
  invoiceId: string | null;
  customerId: string | null;
  created: number;
  refunded: boolean;
}

export interface RefundRecord {
  id: string;
  status: RefundStatus;
  amount: Money;
  chargeId: string | null;
  paymentIntentId: string | null;
  reason: string | null;
  created: number;
}

export interface PreviewLine {
  amountMinor: number;
  description: string;
  proration: boolean;
}

export interface InvoicePreview {
  lines: PreviewLine[];
  prorationCreditMinor: number;
  nextChargeMinor: number;
  currency: string | null;
}

export interface RefundInput {
  invoiceId?: string;
  chargeId?: string;
  amountMinor: number;
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export interface CancelInput {
  subscriptionId: string;
  mode: 'at_period_end' | 'immediate';
}

export interface PlanChangeInput {
  subscriptionId: string;
  subscriptionItemId: string;
  targetPriceId: string;
  prorationBehavior: 'create_prorations' | 'none' | 'always_invoice';
}

export interface BillingProvider {
  getCustomer(id: string): Promise<CustomerRecord>;
  getSubscription(id: string): Promise<SubscriptionRecord>;
  getInvoice(id: string): Promise<InvoiceRecord>;
  resolveChargeForInvoice(invoiceId: string): Promise<ChargeRecord | null>;
  previewChange(input: PlanChangeInput): Promise<InvoicePreview>;
  createRefund(input: RefundInput, idempotencyKey: string): Promise<RefundRecord>;
  cancelSubscription(input: CancelInput, idempotencyKey: string): Promise<SubscriptionRecord>;
  changePlan(input: PlanChangeInput, idempotencyKey: string): Promise<SubscriptionRecord>;
  getRefund(id: string): Promise<RefundRecord>;
}

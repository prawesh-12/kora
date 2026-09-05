import { ToolError, money } from '@kora/core';
import type { Money } from '@kora/core';
import Stripe from 'stripe';
import type {
  BillingProvider,
  CancelInput,
  ChargeRecord,
  CustomerRecord,
  InvoicePreview,
  InvoiceRecord,
  PlanChangeInput,
  RefundInput,
  RefundRecord,
  RefundStatus,
  SubscriptionRecord,
} from './types.js';

export interface StripeBillingProviderOptions {
  resolveKey: () => Promise<string>;
  client?: Stripe | undefined;
  timeoutMs?: number | undefined;
  maxNetworkRetries?: number | undefined;
}

function toMoney(amountMinor: number, currency: string): Money {
  return money(amountMinor, currency.toUpperCase());
}

function refId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

function fail(
  message: string,
  code: string,
  retryable: boolean,
  context: Record<string, unknown>,
): never {
  throw new ToolError(message, { code, retryable, context });
}

export function mapStripeError(err: unknown, op: string): ToolError {
  const context = { op };
  if (err instanceof Stripe.errors.StripeCardError) {
    return new ToolError(`stripe card error during ${op}: ${err.message}`, {
      code: 'CARD_ERROR',
      retryable: false,
      context,
    });
  }
  if (err instanceof Stripe.errors.StripeIdempotencyError) {
    return new ToolError(`stripe idempotency replay during ${op}`, {
      code: 'REPLAYED',
      retryable: false,
      context,
    });
  }
  if (
    err instanceof Stripe.errors.StripeAuthenticationError ||
    err instanceof Stripe.errors.StripePermissionError ||
    err instanceof Stripe.errors.StripeSignatureVerificationError
  ) {
    return new ToolError(`stripe credentials rejected during ${op}`, {
      code: 'CONFIG_ERROR',
      retryable: false,
      context,
    });
  }
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    return new ToolError(`stripe rejected ${op} as invalid`, {
      code: 'UPSTREAM_4XX',
      retryable: false,
      context,
    });
  }
  if (
    err instanceof Stripe.errors.StripeRateLimitError ||
    err instanceof Stripe.errors.StripeAPIError
  ) {
    return new ToolError(`stripe unavailable during ${op}`, {
      code: 'UPSTREAM_5XX',
      retryable: true,
      context,
    });
  }
  if (err instanceof Stripe.errors.StripeConnectionError) {
    if (/timed out/i.test(err.message)) {
      return new ToolError(`stripe request timed out during ${op}`, {
        code: 'UPSTREAM_TIMEOUT',
        retryable: true,
        context,
      });
    }
    return new ToolError(`stripe connection failed during ${op}`, {
      code: 'UPSTREAM_5XX',
      retryable: true,
      context,
    });
  }
  if (err instanceof ToolError) return err;
  return new ToolError(`stripe call ${op} failed`, {
    code: 'UPSTREAM_5XX',
    retryable: true,
    context,
  });
}

function checkStatus<T extends string>(
  value: string | null,
  allowed: readonly T[],
  what: string,
): T {
  if (value !== null && (allowed as readonly string[]).includes(value)) return value as T;
  return fail(`stripe returned an unknown ${what} status`, 'MALFORMED_OUTPUT', false, {
    status: value,
  });
}

const SUBSCRIPTION_STATUSES = [
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'unpaid',
  'paused',
] as const;

const INVOICE_STATUSES = ['draft', 'open', 'paid', 'uncollectible', 'void'] as const;

const REFUND_STATUSES = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const;

export function mapCustomer(customer: Stripe.Customer): CustomerRecord {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name ?? null,
    defaultPaymentMethodId: refId(customer.invoice_settings.default_payment_method),
    currency: customer.currency ? customer.currency.toUpperCase() : null,
  };
}

export function mapSubscription(subscription: Stripe.Subscription): SubscriptionRecord {
  const status = checkStatus(subscription.status, SUBSCRIPTION_STATUSES, 'subscription');
  const customerId = refId(subscription.customer);
  if (!customerId) {
    fail('stripe subscription has no customer', 'MALFORMED_OUTPUT', false, { id: subscription.id });
  }
  let currentPeriodEnd: number | null = null;
  const items = subscription.items.data.map((item) => {
    if (
      item.current_period_end !== null &&
      (currentPeriodEnd === null || item.current_period_end > currentPeriodEnd)
    ) {
      currentPeriodEnd = item.current_period_end;
    }
    if (item.price.unit_amount === null) {
      fail('stripe price has no unit amount', 'MALFORMED_OUTPUT', false, { price: item.price.id });
    }
    return {
      subscriptionItemId: item.id,
      priceId: item.price.id,
      productId: refId(item.price.product) ?? '',
      unitAmount: toMoney(item.price.unit_amount, item.price.currency),
      quantity: item.quantity ?? 1,
    };
  });
  return {
    id: subscription.id,
    status,
    customerId: customerId as string,
    items,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at,
    cancelAt: subscription.cancel_at,
    latestInvoiceId: refId(subscription.latest_invoice),
    collectionMethod: subscription.collection_method,
  };
}

interface InvoiceLinks {
  subscriptionId: string | null;
  paymentIntentId: string | null;
  directChargeId: string | null;
}

export function invoiceLinks(invoice: Stripe.Invoice): InvoiceLinks {
  let subscriptionId: string | null = null;
  if (invoice.parent?.type === 'subscription_details') {
    subscriptionId = refId(invoice.parent.subscription_details?.subscription ?? null);
  }
  let paymentIntentId: string | null = null;
  let directChargeId: string | null = null;
  for (const entry of invoice.payments?.data ?? []) {
    const paymentIntent = refId(entry.payment.payment_intent ?? null);
    if (paymentIntent && !paymentIntentId) paymentIntentId = paymentIntent;
    const charge = refId(entry.payment.charge ?? null);
    if (charge && !directChargeId) directChargeId = charge;
  }
  return { subscriptionId, paymentIntentId, directChargeId };
}

export function mapInvoice(invoice: Stripe.Invoice, chargeId: string | null): InvoiceRecord {
  const status = checkStatus(invoice.status, INVOICE_STATUSES, 'invoice');
  const customerId = refId(invoice.customer);
  if (!customerId) {
    fail('stripe invoice has no customer', 'MALFORMED_OUTPUT', false, { id: invoice.id });
  }
  const links = invoiceLinks(invoice);
  return {
    id: invoice.id,
    status,
    customerId: customerId as string,
    subscriptionId: links.subscriptionId,
    amountDue: toMoney(invoice.amount_due, invoice.currency),
    amountPaid: toMoney(invoice.amount_paid, invoice.currency),
    amountRemaining: toMoney(invoice.amount_remaining, invoice.currency),
    paymentIntentId: links.paymentIntentId,
    chargeId: chargeId ?? links.directChargeId,
    created: invoice.created,
  };
}

export function mapCharge(charge: Stripe.Charge, invoiceId: string | null): ChargeRecord {
  const amountCaptured = toMoney(charge.amount_captured, charge.currency);
  const amountRefunded = toMoney(charge.amount_refunded, charge.currency);
  return {
    id: charge.id,
    amountCaptured,
    amountRefunded,
    remainingRefundable: toMoney(charge.amount_captured - charge.amount_refunded, charge.currency),
    currency: charge.currency.toUpperCase(),
    paymentIntentId: refId(charge.payment_intent),
    invoiceId,
    customerId: refId(charge.customer),
    created: charge.created,
    refunded: charge.refunded,
  };
}

export function mapRefund(refund: Stripe.Refund): RefundRecord {
  const status: RefundStatus = checkStatus(refund.status, REFUND_STATUSES, 'refund');
  return {
    id: refund.id,
    status,
    amount: toMoney(refund.amount, refund.currency),
    chargeId: refId(refund.charge),
    paymentIntentId: refId(refund.payment_intent),
    reason: refund.reason,
    created: refund.created,
  };
}

export function mapPreview(invoice: Stripe.Invoice): InvoicePreview {
  const lines = (invoice.lines?.data ?? []).map((line) => ({
    amountMinor: line.amount,
    description: line.description ?? '',
    proration:
      line.parent?.type === 'subscription_item_details' &&
      line.parent.subscription_item_details?.proration === true,
  }));
  let prorationCreditMinor = 0;
  let nextChargeMinor = 0;
  for (const line of lines) {
    if (line.proration && line.amountMinor < 0) prorationCreditMinor += line.amountMinor;
    if (line.amountMinor > 0) nextChargeMinor += line.amountMinor;
  }
  return {
    lines,
    prorationCreditMinor,
    nextChargeMinor,
    currency: invoice.currency ? invoice.currency.toUpperCase() : null,
  };
}

export class StripeBillingProvider implements BillingProvider {
  private cached: Stripe | null;

  constructor(private readonly options: StripeBillingProviderOptions) {
    this.cached = options.client ?? null;
  }

  private async stripe(): Promise<Stripe> {
    if (this.cached) return this.cached;
    const apiKey = await this.options.resolveKey();
    if (!apiKey) {
      fail('tenant stripe key is missing', 'CONFIG_ERROR', false, {});
    }
    this.cached = new Stripe(apiKey, {
      timeout: this.options.timeoutMs ?? 20000,
      maxNetworkRetries: this.options.maxNetworkRetries ?? 1,
    });
    return this.cached;
  }

  private async call<T>(op: string, fn: (stripe: Stripe) => Promise<T>): Promise<T> {
    const stripe = await this.stripe();
    try {
      return await fn(stripe);
    } catch (err) {
      throw mapStripeError(err, op);
    }
  }

  async getCustomer(id: string): Promise<CustomerRecord> {
    const customer = await this.call('getCustomer', (stripe) => stripe.customers.retrieve(id));
    return mapCustomer(customer as Stripe.Customer);
  }

  async getSubscription(id: string): Promise<SubscriptionRecord> {
    const subscription = await this.call('getSubscription', (stripe) =>
      stripe.subscriptions.retrieve(id),
    );
    return mapSubscription(subscription as Stripe.Subscription);
  }

  async getInvoice(id: string): Promise<InvoiceRecord> {
    const invoice = await this.call('getInvoice', (stripe) =>
      stripe.invoices.retrieve(id, { expand: ['payments.data.payment'] }),
    );
    return mapInvoice(invoice as Stripe.Invoice, null);
  }

  async resolveChargeForInvoice(invoiceId: string): Promise<ChargeRecord | null> {
    const stripe = await this.stripe();
    let invoice: Stripe.Invoice;
    try {
      invoice = (await stripe.invoices.retrieve(invoiceId, {
        expand: ['payments.data.payment'],
      })) as Stripe.Invoice;
    } catch (err) {
      throw mapStripeError(err, 'resolveChargeForInvoice');
    }
    const links = invoiceLinks(invoice);
    if (links.paymentIntentId) {
      let paymentIntent: Stripe.PaymentIntent;
      try {
        paymentIntent = (await stripe.paymentIntents.retrieve(
          links.paymentIntentId,
        )) as Stripe.PaymentIntent;
      } catch (err) {
        throw mapStripeError(err, 'resolveChargeForInvoice');
      }
      const chargeId = refId(paymentIntent.latest_charge);
      if (!chargeId) return null;
      return this.readCharge(stripe, chargeId, invoiceId);
    }
    if (links.directChargeId) return this.readCharge(stripe, links.directChargeId, invoiceId);
    return null;
  }

  private async readCharge(
    stripe: Stripe,
    chargeId: string,
    invoiceId: string,
  ): Promise<ChargeRecord> {
    try {
      const charge = (await stripe.charges.retrieve(chargeId)) as Stripe.Charge;
      return mapCharge(charge, invoiceId);
    } catch (err) {
      throw mapStripeError(err, 'resolveChargeForInvoice');
    }
  }

  async previewChange(input: PlanChangeInput): Promise<InvoicePreview> {
    const preview = await this.call('previewChange', (stripe) =>
      stripe.invoices.createPreview({
        subscription: input.subscriptionId,
        subscription_details: {
          items: [{ id: input.subscriptionItemId, price: input.targetPriceId }],
          proration_behavior: input.prorationBehavior,
        },
      }),
    );
    return mapPreview(preview as Stripe.Invoice);
  }

  async createRefund(input: RefundInput, idempotencyKey: string): Promise<RefundRecord> {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      fail('refund amount must be a positive integer', 'INVALID_INPUT', false, {});
    }
    let chargeId = input.chargeId ?? null;
    if (!chargeId) {
      if (!input.invoiceId) {
        fail('refund needs an invoiceId or a chargeId', 'INVALID_INPUT', false, {});
      }
      const charge = await this.resolveChargeForInvoice(input.invoiceId as string);
      if (!charge) {
        fail('no captured charge behind invoice', 'CHARGE_NOT_FOUND', false, {
          invoiceId: input.invoiceId as string,
        });
      }
      chargeId = (charge as ChargeRecord).id;
    }
    const refund = await this.call('createRefund', (stripe) =>
      stripe.refunds.create(
        { charge: chargeId as string, amount: input.amountMinor, reason: input.reason },
        { idempotencyKey },
      ),
    );
    return mapRefund(refund as Stripe.Refund);
  }

  async cancelSubscription(
    input: CancelInput,
    idempotencyKey: string,
  ): Promise<SubscriptionRecord> {
    if (input.mode === 'immediate') {
      const subscription = await this.call('cancelSubscription', (stripe) =>
        stripe.subscriptions.cancel(input.subscriptionId, {}, { idempotencyKey }),
      );
      return mapSubscription(subscription as Stripe.Subscription);
    }
    const subscription = await this.call('cancelSubscription', (stripe) =>
      stripe.subscriptions.update(
        input.subscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey },
      ),
    );
    return mapSubscription(subscription as Stripe.Subscription);
  }

  async changePlan(input: PlanChangeInput, idempotencyKey: string): Promise<SubscriptionRecord> {
    const subscription = await this.call('changePlan', (stripe) =>
      stripe.subscriptions.update(
        input.subscriptionId,
        {
          items: [{ id: input.subscriptionItemId, price: input.targetPriceId }],
          proration_behavior: input.prorationBehavior,
        },
        { idempotencyKey },
      ),
    );
    return mapSubscription(subscription as Stripe.Subscription);
  }

  async getRefund(id: string): Promise<RefundRecord> {
    const refund = await this.call('getRefund', (stripe) => stripe.refunds.retrieve(id));
    return mapRefund(refund as Stripe.Refund);
  }
}

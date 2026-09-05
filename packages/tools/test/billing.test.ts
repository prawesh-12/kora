import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { ToolError } from '@kora/core';
import {
  StripeBillingProvider,
  invoiceLinks,
  mapCharge,
  mapCustomer,
  mapInvoice,
  mapPreview,
  mapRefund,
  mapStripeError,
  mapSubscription,
} from '../src/billing/stripe-provider.js';

function stripeCustomer(): Stripe.Customer {
  return {
    id: 'cus_1',
    email: 'buyer@example.com',
    name: 'Buyer',
    currency: 'inr',
    invoice_settings: { default_payment_method: 'pm_1' },
  } as unknown as Stripe.Customer;
}

function stripeSubscription(): Stripe.Subscription {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    currency: 'inr',
    cancel_at_period_end: false,
    canceled_at: null,
    cancel_at: null,
    latest_invoice: 'in_1',
    collection_method: 'charge_automatically',
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: 'price_A', product: 'prod_A', unit_amount: 349900, currency: 'inr' },
          quantity: 1,
          current_period_end: 200,
          current_period_start: 100,
        },
        {
          id: 'si_2',
          price: { id: 'price_B', product: { id: 'prod_B' }, unit_amount: 99900, currency: 'inr' },
          quantity: 2,
          current_period_end: 300,
          current_period_start: 100,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function stripeInvoice(): Stripe.Invoice {
  return {
    id: 'in_1',
    status: 'paid',
    customer: 'cus_1',
    currency: 'inr',
    amount_due: 349900,
    amount_paid: 349900,
    amount_remaining: 0,
    created: 1000,
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } },
    payments: { data: [{ payment: { payment_intent: 'pi_1' } }] },
  } as unknown as Stripe.Invoice;
}

function stripeCharge(): Stripe.Charge {
  return {
    id: 'ch_1',
    amount_captured: 349900,
    amount_refunded: 100000,
    currency: 'inr',
    customer: 'cus_1',
    payment_intent: 'pi_1',
    created: 1000,
    refunded: false,
  } as unknown as Stripe.Charge;
}

function stripeRefund(): Stripe.Refund {
  return {
    id: 're_1',
    status: 'succeeded',
    amount: 100000,
    currency: 'inr',
    charge: 'ch_1',
    payment_intent: 'pi_1',
    reason: 'requested_by_customer',
    created: 1100,
  } as unknown as Stripe.Refund;
}

describe('mapStripeError', () => {
  const cases: Array<[Error, string, boolean]> = [
    [new Stripe.errors.StripeCardError({ message: 'declined' }), 'CARD_ERROR', false],
    [new Stripe.errors.StripeIdempotencyError({ message: 'replayed' }), 'REPLAYED', false],
    [new Stripe.errors.StripeAuthenticationError({ message: 'bad key' }), 'CONFIG_ERROR', false],
    [new Stripe.errors.StripePermissionError({ message: 'no scope' }), 'CONFIG_ERROR', false],
    [
      new Stripe.errors.StripeInvalidRequestError({ message: 'no such sub' }),
      'UPSTREAM_4XX',
      false,
    ],
    [new Stripe.errors.StripeRateLimitError({ message: 'slow down' }), 'UPSTREAM_5XX', true],
    [new Stripe.errors.StripeAPIError({ message: 'stripe broke' }), 'UPSTREAM_5XX', true],
    [
      new Stripe.errors.StripeConnectionError({ message: 'Request to Stripe timed out' }),
      'UPSTREAM_TIMEOUT',
      true,
    ],
    [
      new Stripe.errors.StripeConnectionError({ message: 'connection reset' }),
      'UPSTREAM_5XX',
      true,
    ],
  ];
  for (const [err, code, retryable] of cases) {
    it(`maps ${err.constructor.name} to ${code}`, () => {
      const mapped = mapStripeError(err, 'test-op');
      expect(mapped).toBeInstanceOf(ToolError);
      expect(mapped.code).toBe(code);
      expect(mapped.retryable).toBe(retryable);
    });
  }

  it('passes ToolError through and wraps unknown errors as 5xx', () => {
    const original = new ToolError('denied', { code: 'POLICY_DENIED', retryable: false });
    expect(mapStripeError(original, 'test-op')).toBe(original);
    const wrapped = mapStripeError(new Error('boom'), 'test-op');
    expect(wrapped.code).toBe('UPSTREAM_5XX');
    expect(wrapped.retryable).toBe(true);
  });
});

describe('record mapping', () => {
  it('maps a customer with integer amounts untouched', () => {
    const record = mapCustomer(stripeCustomer());
    expect(record).toEqual({
      id: 'cus_1',
      email: 'buyer@example.com',
      name: 'Buyer',
      defaultPaymentMethodId: 'pm_1',
      currency: 'INR',
    });
  });

  it('maps a subscription, taking the latest period end across items', () => {
    const record = mapSubscription(stripeSubscription());
    expect(record.id).toBe('sub_1');
    expect(record.status).toBe('active');
    expect(record.customerId).toBe('cus_1');
    expect(record.currentPeriodEnd).toBe(300);
    expect(record.items).toHaveLength(2);
    expect(record.items[0]).toEqual({
      subscriptionItemId: 'si_1',
      priceId: 'price_A',
      productId: 'prod_A',
      unitAmount: { amountMinor: 349900, currency: 'INR' },
      quantity: 1,
    });
    expect(record.items[1]?.productId).toBe('prod_B');
    expect(record.latestInvoiceId).toBe('in_1');
    expect(record.collectionMethod).toBe('charge_automatically');
  });

  it('resolves invoice links through parent and payments', () => {
    const links = invoiceLinks(stripeInvoice());
    expect(links).toEqual({
      subscriptionId: 'sub_1',
      paymentIntentId: 'pi_1',
      directChargeId: null,
    });
    const record = mapInvoice(stripeInvoice(), 'ch_1');
    expect(record.amountDue).toEqual({ amountMinor: 349900, currency: 'INR' });
    expect(record.amountPaid).toEqual({ amountMinor: 349900, currency: 'INR' });
    expect(record.amountRemaining).toEqual({ amountMinor: 0, currency: 'INR' });
    expect(record.chargeId).toBe('ch_1');
    expect(record.status).toBe('paid');
  });

  it('computes remaining refundable as captured minus refunded', () => {
    const record = mapCharge(stripeCharge(), 'in_1');
    expect(record.amountCaptured).toEqual({ amountMinor: 349900, currency: 'INR' });
    expect(record.amountRefunded).toEqual({ amountMinor: 100000, currency: 'INR' });
    expect(record.remainingRefundable).toEqual({ amountMinor: 249900, currency: 'INR' });
    expect(record.invoiceId).toBe('in_1');
    expect(record.paymentIntentId).toBe('pi_1');
  });

  it('maps a refund with status and money', () => {
    const record = mapRefund(stripeRefund());
    expect(record).toEqual({
      id: 're_1',
      status: 'succeeded',
      amount: { amountMinor: 100000, currency: 'INR' },
      chargeId: 'ch_1',
      paymentIntentId: 'pi_1',
      reason: 'requested_by_customer',
      created: 1100,
    });
  });

  it('maps a preview, separating proration credit from the next charge', () => {
    const preview = mapPreview({
      currency: 'inr',
      lines: {
        data: [
          {
            amount: -50000,
            description: 'Unused time',
            parent: {
              type: 'subscription_item_details',
              subscription_item_details: { proration: true },
            },
          },
          {
            amount: 80000,
            description: 'Remaining time on new plan',
            parent: {
              type: 'subscription_item_details',
              subscription_item_details: { proration: true },
            },
          },
          {
            amount: 100,
            description: 'Tax',
            parent: { type: 'invoice_item_details', invoice_item_details: null },
          },
        ],
      },
    } as unknown as Stripe.Invoice);
    expect(preview.lines).toHaveLength(3);
    expect(preview.lines[0]?.proration).toBe(true);
    expect(preview.lines[2]?.proration).toBe(false);
    expect(preview.prorationCreditMinor).toBe(-50000);
    expect(preview.nextChargeMinor).toBe(80100);
    expect(preview.currency).toBe('INR');
  });

  it('rejects unknown statuses instead of guessing', () => {
    expect(() =>
      mapRefund({ ...stripeRefund(), status: 'mysterious' } as unknown as Stripe.Refund),
    ).toThrowError(ToolError);
  });
});

describe('StripeBillingProvider with a fake client', () => {
  function fakeClient(calls: Array<{ op: string; options: unknown }>) {
    const refund = stripeRefund();
    return {
      refunds: {
        create: async (params: unknown, options: unknown) => {
          calls.push({ op: 'refunds.create', options });
          return { ...refund, amount: (params as { amount: number }).amount };
        },
        retrieve: async (id: string) => {
          calls.push({ op: 'refunds.retrieve', options: { id } });
          return { ...refund, id };
        },
      },
      invoices: {
        retrieve: async () => stripeInvoice(),
      },
      paymentIntents: {
        retrieve: async () => ({ id: 'pi_1', latest_charge: 'ch_1' }),
      },
      charges: {
        retrieve: async () => stripeCharge(),
      },
    } as unknown as Stripe;
  }

  it('round-trips createRefund to getRefund with matching amount and status', async () => {
    const calls: Array<{ op: string; options: unknown }> = [];
    const provider = new StripeBillingProvider({
      resolveKey: async () => 'sk_test_fake',
      client: fakeClient(calls),
    });
    const created = await provider.createRefund(
      { chargeId: 'ch_1', amountMinor: 100000, reason: 'requested_by_customer' },
      'claim-key-1',
    );
    expect(created.id).toBe('re_1');
    expect(created.status).toBe('succeeded');
    expect(created.amount).toEqual({ amountMinor: 100000, currency: 'INR' });

    const readBack = await provider.getRefund(created.id);
    expect(readBack.id).toBe(created.id);
    expect(readBack.status).toBe(created.status);
    expect(readBack.amount).toEqual(created.amount);

    const createCall = calls.find((c) => c.op === 'refunds.create');
    expect(createCall?.options).toEqual({ idempotencyKey: 'claim-key-1' });
  });

  it('resolves the charge behind an invoice through payment intent to latest charge', async () => {
    const provider = new StripeBillingProvider({
      resolveKey: async () => 'sk_test_fake',
      client: fakeClient([]),
    });
    const charge = await provider.resolveChargeForInvoice('in_1');
    expect(charge?.id).toBe('ch_1');
    expect(charge?.invoiceId).toBe('in_1');
    expect(charge?.remainingRefundable).toEqual({ amountMinor: 249900, currency: 'INR' });
  });

  it('returns null when no charge backs the invoice', async () => {
    const client = {
      invoices: { retrieve: async () => ({ ...stripeInvoice(), payments: { data: [] } }) },
    } as unknown as Stripe;
    const provider = new StripeBillingProvider({ resolveKey: async () => 'x', client });
    await expect(provider.resolveChargeForInvoice('in_1')).resolves.toBeNull();
  });

  it('fails closed with CONFIG_ERROR when the tenant key is missing', async () => {
    const provider = new StripeBillingProvider({ resolveKey: async () => '' });
    await expect(provider.getRefund('re_1')).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });
});

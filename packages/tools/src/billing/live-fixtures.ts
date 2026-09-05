import Stripe from 'stripe';
import {
  FIXTURE_CURRENCY,
  FIXTURE_PLAN_AMOUNTS,
  type FixtureBackend,
  type FixtureChargeInput,
  type FixtureCustomerInput,
  type FixtureSubscriptionInput,
} from './fixtures.js';
import { invoiceLinks } from './stripe-provider.js';

const CLOCK_NAME = 'kora-fixtures';
const PRICE_LOOKUP_KEYS = { basic: 'kora_fixture_basic', pro: 'kora_fixture_pro' } as const;
const PRODUCT_KEY = 'plans';
const TEST_PAYMENT_METHOD = 'pm_card_visa';
const ADVANCE_POLL_MS = 1500;
const ADVANCE_POLL_LIMIT = 60;

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

function unix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every object it creates carries `metadata.koraFixture` (prices also carry a
 * stable `lookup_key`) so a person can find and delete them. Customers and
 * subscriptions hang off one named test clock, and deleting that clock in the
 * Stripe dashboard removes them all.
 */
export class LiveFixtureBackend implements FixtureBackend {
  readonly name = 'live' as const;
  private readonly stripe: Stripe;
  private clockId: string | null = null;

  constructor(apiKey: string) {
    if (!apiKey.startsWith('sk_test_')) {
      throw new Error('fixtures refuse to run: STRIPE_DEV_KEY must be a test-mode sk_test_ key');
    }
    this.stripe = new Stripe(apiKey, { maxNetworkRetries: 2 });
  }

  /** A configured price id wins only if it still exists here; otherwise look up the
   * stable lookup key, and create the price once if that misses too. */
  async ensurePriceIds(configured: {
    basic?: string | undefined;
    pro?: string | undefined;
  }): Promise<{ basic: string; pro: string }> {
    return {
      basic: await this.ensurePrice('basic', configured.basic),
      pro: await this.ensurePrice('pro', configured.pro),
    };
  }

  private async ensurePrice(kind: 'basic' | 'pro', configured?: string): Promise<string> {
    if (configured) {
      const existing = await this.stripe.prices.retrieve(configured).catch(() => null);
      if (existing) return existing.id;
    }
    const lookupKey = PRICE_LOOKUP_KEYS[kind];
    const known = await this.stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
    const found = known.data[0];
    if (found) return found.id;

    const price = await this.stripe.prices.create({
      product: await this.ensureProduct(),
      currency: FIXTURE_CURRENCY.toLowerCase(),
      unit_amount: FIXTURE_PLAN_AMOUNTS[kind],
      // Yearly, so nothing renews inside the 45 days the fixtures span and each
      // subscription keeps exactly one paid invoice.
      recurring: { interval: 'year' },
      lookup_key: lookupKey,
      metadata: { koraFixture: kind },
    });
    return price.id;
  }

  private async ensureProduct(): Promise<string> {
    const products = await this.stripe.products.list({ limit: 100 });
    const existing = products.data.find((p) => p.metadata?.koraFixture === PRODUCT_KEY);
    if (existing) return existing.id;
    const created = await this.stripe.products.create({
      name: 'Kora Fixture Plans',
      metadata: { koraFixture: PRODUCT_KEY },
    });
    return created.id;
  }

  async ensureTestClock(startTime: string): Promise<{ id: string }> {
    const clocks = await this.stripe.testHelpers.testClocks.list({ limit: 100 });
    // A clock's frozen_time moves as it advances, so an existing fixture clock can
    // never be matched by the time it was started at. Match the name and reuse it.
    // To rebuild the fixtures from scratch, delete the `kora-fixtures` clock first.
    const existing = clocks.data.find((c) => c.name === CLOCK_NAME);
    const clock =
      existing ??
      (await this.stripe.testHelpers.testClocks.create({
        frozen_time: unix(startTime),
        name: CLOCK_NAME,
      }));
    this.clockId = clock.id;
    return { id: clock.id };
  }

  async ensureCustomer(
    input: FixtureCustomerInput,
  ): Promise<{ id: string; paymentMethodId: string }> {
    const clock = this.requireClock();
    // Customers attached to a test clock are hidden from `list` unless the clock
    // is named explicitly.
    const known = await this.stripe.customers.list({
      email: input.email,
      test_clock: clock,
      limit: 1,
    });
    const customer =
      known.data[0] ??
      (await this.stripe.customers.create({
        email: input.email,
        name: input.name,
        test_clock: clock,
        metadata: { koraFixture: input.key },
      }));

    const attached = idOf(customer.invoice_settings.default_payment_method);
    if (attached) return { id: customer.id, paymentMethodId: attached };

    const paymentMethod = await this.stripe.paymentMethods.attach(TEST_PAYMENT_METHOD, {
      customer: customer.id,
    });
    await this.stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });
    return { id: customer.id, paymentMethodId: paymentMethod.id };
  }

  async ensureSubscription(
    input: FixtureSubscriptionInput,
  ): Promise<{ id: string; status: string }> {
    const known = await this.stripe.subscriptions.list({
      customer: input.customerId,
      status: 'all',
      limit: 100,
    });
    const existing = known.data.find((s) => s.metadata?.koraFixture === input.key);
    if (existing) return { id: existing.id, status: existing.status };

    const created = await this.stripe.subscriptions.create({
      customer: input.customerId,
      items: [{ price: input.priceId }],
      metadata: { koraFixture: input.key },
    });
    return { id: created.id, status: created.status };
  }

  async ensurePaidCharge(
    input: FixtureChargeInput,
  ): Promise<{ id: string; invoiceId: string; createdAt: string }> {
    // Creating the subscription already produced and paid the invoice, so this is
    // a read. Stripe lists invoices newest first and the fixture is about the
    // subscription's first one.
    const invoices = await this.stripe.invoices.list({
      subscription: input.subscriptionId,
      status: 'paid',
      limit: 100,
    });
    const first = invoices.data.at(-1);
    if (!first?.id) {
      throw new Error(`subscription ${input.subscriptionId} has no paid invoice`);
    }

    const invoice = await this.stripe.invoices.retrieve(first.id, {
      expand: ['payments.data.payment'],
    });
    const links = invoiceLinks(invoice);
    let chargeId = links.directChargeId;
    if (!chargeId && links.paymentIntentId) {
      const intent = await this.stripe.paymentIntents.retrieve(links.paymentIntentId);
      chargeId = idOf(intent.latest_charge);
    }
    if (!chargeId) {
      throw new Error(`invoice ${first.id} has no captured charge`);
    }

    return {
      id: chargeId,
      invoiceId: first.id,
      // A charge is stamped with real wall-clock time even on a test clock. Only
      // the invoice carries the clock's time, so the fixture's age comes from it.
      createdAt: iso(invoice.created),
    };
  }

  async advanceClock(clockId: string, seconds: number): Promise<{ now: string }> {
    const current = await this.stripe.testHelpers.testClocks.retrieve(clockId);
    let clock = await this.stripe.testHelpers.testClocks.advance(clockId, {
      frozen_time: current.frozen_time + Math.round(seconds),
    });
    // Advancing is asynchronous: the invoices it triggers do not exist until the
    // clock reports ready again.
    for (let i = 0; clock.status === 'advancing' && i < ADVANCE_POLL_LIMIT; i += 1) {
      await sleep(ADVANCE_POLL_MS);
      clock = await this.stripe.testHelpers.testClocks.retrieve(clockId);
    }
    if (clock.status !== 'ready') {
      throw new Error(`test clock ${clockId} is ${clock.status} after advancing`);
    }
    return { now: iso(clock.frozen_time) };
  }

  async clockNow(clockId: string): Promise<{ now: string }> {
    const clock = await this.stripe.testHelpers.testClocks.retrieve(clockId);
    return { now: iso(clock.frozen_time) };
  }

  private requireClock(): string {
    if (!this.clockId) throw new Error('ensureTestClock must run before the rest of the fixtures');
    return this.clockId;
  }
}

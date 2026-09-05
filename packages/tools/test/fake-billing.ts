import { ToolError } from '@kora/core';
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
} from '../src/billing/types.js';

/**
 * What a test can make the provider do instead of behaving. `500`, `timeout` and
 * `config` throw the code the Stripe provider maps that class of failure to;
 * `malformed` returns a record the tool's output schema rejects; `stale` accepts
 * writes but serves read-backs from the state before them, which is how a write
 * that did not really land is simulated.
 */
export type FakeFault = '500' | 'timeout' | 'config' | 'malformed' | 'stale';

export interface FakeCall {
  method: string;
  input: unknown;
}

export interface FakeBillingSeed {
  customers?: CustomerRecord[];
  subscriptions?: SubscriptionRecord[];
  invoices?: InvoiceRecord[];
  /** Charges are looked up by the invoice they paid, as Stripe resolves them. */
  charges?: ChargeRecord[];
  preview?: InvoicePreview;
}

function notFound(what: string, id: string): ToolError {
  return new ToolError(`${what} ${id} does not exist`, { code: 'UPSTREAM_4XX', retryable: false });
}

export class FakeBillingProvider implements BillingProvider {
  readonly calls: FakeCall[] = [];
  fault: FakeFault | null = null;
  refundStatus: RefundStatus = 'succeeded';

  private readonly customers = new Map<string, CustomerRecord>();
  private readonly seededSubscriptions = new Map<string, SubscriptionRecord>();
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly invoices = new Map<string, InvoiceRecord>();
  private readonly chargesByInvoice = new Map<string, ChargeRecord>();
  private readonly refunds = new Map<string, RefundRecord>();
  private readonly refundsByKey = new Map<string, RefundRecord>();
  private readonly preview: InvoicePreview;
  private seq = 0;

  constructor(seed: FakeBillingSeed = {}) {
    for (const c of seed.customers ?? []) this.customers.set(c.id, c);
    for (const s of seed.subscriptions ?? []) {
      this.seededSubscriptions.set(s.id, s);
      this.subscriptions.set(s.id, s);
    }
    for (const i of seed.invoices ?? []) this.invoices.set(i.id, i);
    for (const c of seed.charges ?? []) {
      if (c.invoiceId) this.chargesByInvoice.set(c.invoiceId, c);
    }
    this.preview = seed.preview ?? {
      lines: [],
      prorationCreditMinor: 0,
      nextChargeMinor: 0,
      currency: 'INR',
    };
  }

  callsTo(method: string): FakeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  get createdRefunds(): RefundRecord[] {
    return [...this.refunds.values()];
  }

  private enter(method: string, input: unknown): void {
    this.calls.push({ method, input });
    if (this.fault === '500') {
      throw new ToolError(`injected 500 on ${method}`, { code: 'UPSTREAM_5XX', retryable: true });
    }
    if (this.fault === 'timeout') {
      throw new ToolError(`injected timeout on ${method}`, {
        code: 'UPSTREAM_TIMEOUT',
        retryable: true,
      });
    }
    if (this.fault === 'config') {
      throw new ToolError(`injected credential failure on ${method}`, {
        code: 'CONFIG_ERROR',
        retryable: false,
      });
    }
  }

  getCustomer(id: string): Promise<CustomerRecord> {
    this.enter('getCustomer', id);
    const found = this.customers.get(id);
    if (!found) throw notFound('customer', id);
    return Promise.resolve(found);
  }

  getSubscription(id: string): Promise<SubscriptionRecord> {
    this.enter('getSubscription', id);
    const live = this.subscriptions.get(id);
    if (!live) throw notFound('subscription', id);
    if (this.fault === 'malformed') {
      return Promise.resolve({ ...live, status: 'exploded' } as unknown as SubscriptionRecord);
    }
    if (this.fault === 'stale') return Promise.resolve(this.seededSubscriptions.get(id) ?? live);
    return Promise.resolve(live);
  }

  getInvoice(id: string): Promise<InvoiceRecord> {
    this.enter('getInvoice', id);
    const found = this.invoices.get(id);
    if (!found) throw notFound('invoice', id);
    return Promise.resolve(found);
  }

  resolveChargeForInvoice(invoiceId: string): Promise<ChargeRecord | null> {
    this.enter('resolveChargeForInvoice', invoiceId);
    return Promise.resolve(this.chargesByInvoice.get(invoiceId) ?? null);
  }

  previewChange(input: PlanChangeInput): Promise<InvoicePreview> {
    this.enter('previewChange', input);
    return Promise.resolve(this.preview);
  }

  createRefund(input: RefundInput, idempotencyKey: string): Promise<RefundRecord> {
    this.enter('createRefund', input);
    const existing = this.refundsByKey.get(idempotencyKey);
    if (existing) return Promise.resolve(existing);

    const charge = input.chargeId ? this.chargeById(input.chargeId) : null;
    this.seq += 1;
    const record: RefundRecord = {
      id: `re_${this.seq}`,
      status: this.refundStatus,
      amount: { amountMinor: input.amountMinor, currency: charge?.currency ?? 'INR' },
      chargeId: input.chargeId ?? null,
      paymentIntentId: charge?.paymentIntentId ?? null,
      reason: input.reason,
      created: Math.floor(Date.now() / 1000),
    };
    this.refundsByKey.set(idempotencyKey, record);
    this.refunds.set(record.id, record);
    return Promise.resolve(record);
  }

  getRefund(id: string): Promise<RefundRecord> {
    this.enter('getRefund', id);
    if (this.fault === 'stale') throw notFound('refund', id);
    const found = this.refunds.get(id);
    if (!found) throw notFound('refund', id);
    return Promise.resolve(found);
  }

  cancelSubscription(input: CancelInput, _idempotencyKey: string): Promise<SubscriptionRecord> {
    this.enter('cancelSubscription', input);
    const live = this.subscriptions.get(input.subscriptionId);
    if (!live) throw notFound('subscription', input.subscriptionId);
    const next: SubscriptionRecord =
      input.mode === 'immediate'
        ? { ...live, status: 'canceled', canceledAt: Math.floor(Date.now() / 1000) }
        : { ...live, cancelAtPeriodEnd: true, cancelAt: live.currentPeriodEnd };
    this.subscriptions.set(next.id, next);
    return Promise.resolve(next);
  }

  changePlan(input: PlanChangeInput, _idempotencyKey: string): Promise<SubscriptionRecord> {
    this.enter('changePlan', input);
    const live = this.subscriptions.get(input.subscriptionId);
    if (!live) throw notFound('subscription', input.subscriptionId);
    const next: SubscriptionRecord = {
      ...live,
      items: live.items.map((item) =>
        item.subscriptionItemId === input.subscriptionItemId
          ? { ...item, priceId: input.targetPriceId }
          : item,
      ),
    };
    this.subscriptions.set(next.id, next);
    return Promise.resolve(next);
  }

  private chargeById(chargeId: string): ChargeRecord | null {
    return [...this.chargesByInvoice.values()].find((c) => c.id === chargeId) ?? null;
  }
}

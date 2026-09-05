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
  SubscriptionRecord,
} from '@kora/tools';
import { verifyRefund } from '@kora/tools';

export type BillingTransportFault = 'timeout' | '500' | 'slow';

export interface FaultInjectionOptions {
  rate: number;
  faults?: BillingTransportFault[];
  slowMs?: number;
  random?: () => number;
}

export interface BoundaryCall {
  method: string;
  fault: BillingTransportFault | null;
}

function notWired(method: string): never {
  throw new ToolError(`stub billing provider does not implement ${method}`, {
    code: 'CONFIG_ERROR',
  });
}

export class FaultInjectingBillingProvider implements BillingProvider {
  readonly calls: BoundaryCall[] = [];

  constructor(
    private readonly inner: BillingProvider,
    private readonly options: FaultInjectionOptions,
  ) {}

  private pickFault(): BillingTransportFault | null {
    const faults = this.options.faults ?? ['timeout', '500', 'slow'];
    const random = this.options.random ?? Math.random;
    if (this.options.rate <= 0 || random() >= this.options.rate) return null;
    return faults[Math.floor(random() * faults.length)] ?? '500';
  }

  private async invoke<T>(method: string, fn: () => Promise<T>): Promise<T> {
    const fault = this.pickFault();
    this.calls.push({ method, fault });
    if (fault === 'slow') {
      await new Promise((r) => setTimeout(r, this.options.slowMs ?? 50));
      return fn();
    }
    if (fault === 'timeout') {
      throw new ToolError(`injected timeout on ${method}`, {
        code: 'UPSTREAM_TIMEOUT',
        retryable: true,
      });
    }
    if (fault === '500') {
      throw new ToolError(`injected 500 on ${method}`, {
        code: 'UPSTREAM_5XX',
        retryable: true,
      });
    }
    return fn();
  }

  getCustomer(id: string): Promise<CustomerRecord> {
    return this.invoke('getCustomer', () => this.inner.getCustomer(id));
  }

  getSubscription(id: string): Promise<SubscriptionRecord> {
    return this.invoke('getSubscription', () => this.inner.getSubscription(id));
  }

  getInvoice(id: string): Promise<InvoiceRecord> {
    return this.invoke('getInvoice', () => this.inner.getInvoice(id));
  }

  resolveChargeForInvoice(invoiceId: string): Promise<ChargeRecord | null> {
    return this.invoke('resolveChargeForInvoice', () =>
      this.inner.resolveChargeForInvoice(invoiceId),
    );
  }

  previewChange(input: PlanChangeInput): Promise<InvoicePreview> {
    return this.invoke('previewChange', () => this.inner.previewChange(input));
  }

  createRefund(input: RefundInput, idempotencyKey: string): Promise<RefundRecord> {
    return this.invoke('createRefund', () => this.inner.createRefund(input, idempotencyKey));
  }

  cancelSubscription(input: CancelInput, idempotencyKey: string): Promise<SubscriptionRecord> {
    return this.invoke('cancelSubscription', () =>
      this.inner.cancelSubscription(input, idempotencyKey),
    );
  }

  changePlan(input: PlanChangeInput, idempotencyKey: string): Promise<SubscriptionRecord> {
    return this.invoke('changePlan', () => this.inner.changePlan(input, idempotencyKey));
  }

  getRefund(id: string): Promise<RefundRecord> {
    return this.invoke('getRefund', () => this.inner.getRefund(id));
  }
}

let faultRate = 0;

/**
 * Chaos is a process-wide switch, the way the transport it stands in for is: the
 * scenario runner installs a fresh provider per scenario and has to know whether
 * this pass is meant to be faulty.
 */
export function setBillingFaultRate(rate: number): void {
  faultRate = rate;
}

export function withInjectedFaults(provider: BillingProvider): BillingProvider {
  return faultRate > 0
    ? new FaultInjectingBillingProvider(provider, { rate: faultRate })
    : provider;
}

export interface RecordingStubOptions {
  refundStatus?: RefundRecord['status'];
}

export class RecordingStubBillingProvider implements BillingProvider {
  readonly refundsByKey = new Map<string, RefundRecord>();
  readonly refunds: RefundRecord[] = [];
  private seq = 0;

  constructor(private readonly options: RecordingStubOptions = {}) {}

  private refundFor(key: string, input: RefundInput): RefundRecord {
    const existing = this.refundsByKey.get(key);
    if (existing) return existing;
    this.seq += 1;
    const record: RefundRecord = {
      id: `re_chaos_${this.seq}`,
      status: this.options.refundStatus ?? 'succeeded',
      amount: { amountMinor: input.amountMinor, currency: 'INR' },
      chargeId: input.chargeId ?? null,
      paymentIntentId: null,
      reason: input.reason,
      created: Date.now(),
    };
    this.refundsByKey.set(key, record);
    this.refunds.push(record);
    return record;
  }

  getCustomer(): Promise<CustomerRecord> {
    return Promise.reject(notWired('getCustomer'));
  }

  getSubscription(): Promise<SubscriptionRecord> {
    return Promise.reject(notWired('getSubscription'));
  }

  getInvoice(): Promise<InvoiceRecord> {
    return Promise.reject(notWired('getInvoice'));
  }

  resolveChargeForInvoice(): Promise<ChargeRecord | null> {
    return Promise.resolve(null);
  }

  previewChange(): Promise<InvoicePreview> {
    return Promise.reject(notWired('previewChange'));
  }

  createRefund(input: RefundInput, idempotencyKey: string): Promise<RefundRecord> {
    return Promise.resolve(this.refundFor(idempotencyKey, input));
  }

  cancelSubscription(): Promise<SubscriptionRecord> {
    return Promise.reject(notWired('cancelSubscription'));
  }

  changePlan(): Promise<SubscriptionRecord> {
    return Promise.reject(notWired('changePlan'));
  }

  getRefund(id: string): Promise<RefundRecord> {
    const found = this.refunds.find((r) => r.id === id);
    if (!found) {
      throw new ToolError(`refund ${id} not found`, { code: 'UPSTREAM_4XX' });
    }
    return Promise.resolve(found);
  }
}

export interface BillingChaosReport {
  attempts: number;
  faultsInjected: number;
  storedRefunds: number;
  duplicateRefunds: number;
  unverifiedClaims: number;
}

export async function runBillingChaos(args: {
  provider: FaultInjectingBillingProvider;
  stub: RecordingStubBillingProvider;
  attempts: Array<{ input: RefundInput; idempotencyKey: string }>;
}): Promise<BillingChaosReport> {
  let unverifiedClaims = 0;

  for (const attempt of args.attempts) {
    let created: RefundRecord;
    try {
      created = await args.provider.createRefund(attempt.input, attempt.idempotencyKey);
    } catch (e) {
      if (e instanceof ToolError && (e.code === 'UPSTREAM_TIMEOUT' || e.code === 'UPSTREAM_5XX')) {
        continue;
      }
      throw e;
    }
    const verification = await verifyRefund(
      args.provider,
      { amountMinor: attempt.input.amountMinor },
      {
        id: created.id,
        amountMinor: created.amount.amountMinor,
        currency: created.amount.currency,
      },
    ).catch(() => ({ verified: false as const, observed: null, reason: 'read_back_failed' }));
    if (!verification.verified) unverifiedClaims += 1;
  }

  const stored = new Map<string, number>();
  const refunds = args.stub.refunds;
  for (const r of refunds) stored.set(r.id, (stored.get(r.id) ?? 0) + 1);

  return {
    attempts: args.attempts.length,
    faultsInjected: args.provider.calls.filter((c) => c.fault !== null).length,
    storedRefunds: refunds.length,
    duplicateRefunds: [...stored.values()].filter((n) => n > 1).length,
    unverifiedClaims,
  };
}

import type {
  BillingProvider,
  CancelInput,
  ChargeRecord,
  InvoicePreview,
  InvoiceRecord,
  PlanChangeInput,
  RefundInput,
  RefundRecord,
  SubscriptionRecord,
} from '@kora/tools';

export interface ScenarioSeed {
  customerKey?: string;
  subscriptionKey?: string;
  chargeKey?: string;
  invoiceKey?: string;
}

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);
const inr = (amountMinor: number) => ({ amountMinor, currency: 'INR' });

const BASIC = 349900;
const PRO = 199900;
const HIGH = 899900;

const SUBSCRIPTION_IDS: Record<string, string> = {
  'recent-sub': 'sub_recent',
  'old-sub': 'sub_old',
  'high-sub': 'sub_high',
  'unpaid-sub': 'sub_unpaid',
  'big-sub': 'sub_big',
};

export function subscriptionIdForKey(key: string | undefined): string | null {
  if (!key) return null;
  return SUBSCRIPTION_IDS[key] ?? null;
}

function subscription(
  id: string,
  invoiceId: string,
  status: SubscriptionRecord['status'] = 'active',
): SubscriptionRecord {
  return {
    id,
    status,
    customerId: 'cus_014',
    items: [
      {
        subscriptionItemId: `si_${id}`,
        priceId: 'price_basic',
        productId: 'prod_basic',
        unitAmount: inr(BASIC),
        quantity: 1,
      },
    ],
    currentPeriodEnd: nowSec() + 30 * DAY,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelAt: null,
    latestInvoiceId: invoiceId,
    collectionMethod: 'charge_automatically',
  };
}

function invoice(
  id: string,
  subscriptionId: string,
  amountMinor: number,
  paid: boolean,
): InvoiceRecord {
  return {
    id,
    status: paid ? 'paid' : 'open',
    customerId: 'cus_014',
    subscriptionId,
    amountDue: inr(amountMinor),
    amountPaid: inr(paid ? amountMinor : 0),
    amountRemaining: inr(paid ? 0 : amountMinor),
    paymentIntentId: paid ? `pi_${id}` : null,
    chargeId: paid ? `ch_${id}` : null,
    created: nowSec(),
  };
}

function charge(id: string, invoiceId: string, amountMinor: number, ageDays: number): ChargeRecord {
  return {
    id,
    amountCaptured: inr(amountMinor),
    amountRefunded: inr(0),
    remainingRefundable: inr(amountMinor),
    currency: 'INR',
    paymentIntentId: `pi_${invoiceId}`,
    invoiceId,
    customerId: 'cus_014',
    created: nowSec() - ageDays * DAY,
    refunded: false,
  };
}

function previewFor(subscriptionId: string): InvoicePreview {
  if (subscriptionId === 'sub_big') {
    return {
      lines: [
        { amountMinor: -250000, description: 'unused time on price_basic', proration: true },
        { amountMinor: PRO, description: 'remaining time on price_pro', proration: false },
      ],
      prorationCreditMinor: 250000,
      nextChargeMinor: PRO,
      currency: 'INR',
    };
  }
  return {
    lines: [{ amountMinor: PRO, description: 'remaining time on price_pro', proration: false }],
    prorationCreditMinor: 0,
    nextChargeMinor: PRO,
    currency: 'INR',
  };
}

export function createScenarioStub(seed: ScenarioSeed): BillingProvider {
  const subs = new Map<string, SubscriptionRecord>([
    ['sub_recent', subscription('sub_recent', 'in_recent')],
    ['sub_old', subscription('sub_old', 'in_old')],
    ['sub_high', { ...subscription('sub_high', 'in_high'), items: [
      {
        subscriptionItemId: 'si_sub_high',
        priceId: 'price_premium',
        productId: 'prod_premium',
        unitAmount: inr(HIGH),
        quantity: 1,
      },
    ] }],
    ['sub_unpaid', { ...subscription('sub_unpaid', 'in_unpaid'), status: 'unpaid' }],
    ['sub_big', subscription('sub_big', 'in_big')],
  ]);
  const invoices = new Map<string, InvoiceRecord>([
    ['in_recent', invoice('in_recent', 'sub_recent', BASIC, true)],
    ['in_old', invoice('in_old', 'sub_old', BASIC, true)],
    ['in_high', invoice('in_high', 'sub_high', HIGH, true)],
    ['in_unpaid', invoice('in_unpaid', 'sub_unpaid', BASIC, false)],
    ['in_big', invoice('in_big', 'sub_big', BASIC, true)],
  ]);
  const charges = new Map<string, ChargeRecord>([
    ['in_recent', charge('ch_recent', 'in_recent', BASIC, 5)],
    ['in_old', charge('ch_old', 'in_old', BASIC, 45)],
    ['in_high', charge('ch_high', 'in_high', HIGH, 5)],
    ['in_big', charge('ch_big', 'in_big', BASIC, 5)],
  ]);
  const pendingRefunds = seed.chargeKey === 'pending-charge';
  const refunds = new Map<string, RefundRecord>();
  const byKey = new Map<string, RefundRecord>();
  let n = 0;

  const notFound = (what: string): Error =>
    Object.assign(new Error(`no such ${what}`), { code: 'UPSTREAM_4XX' });

  return {
    getCustomer: async (id) => ({
      id,
      email: 'customer@example.com',
      name: 'Scenario Customer',
      defaultPaymentMethodId: null,
      currency: 'INR',
    }),
    getSubscription: async (id) => {
      const sub = subs.get(id);
      if (!sub) throw notFound(`subscription ${id}`);
      return { ...sub, items: sub.items.map((item) => ({ ...item })) };
    },
    getInvoice: async (id) => {
      const inv = invoices.get(id);
      if (!inv) throw notFound(`invoice ${id}`);
      return { ...inv };
    },
    resolveChargeForInvoice: async (invoiceId) => {
      const ch = charges.get(invoiceId);
      return ch ? { ...ch } : null;
    },
    previewChange: async (input: PlanChangeInput) => previewFor(input.subscriptionId),
    createRefund: async (input: RefundInput, key: string) => {
      const existing = byKey.get(key);
      if (existing) return { ...existing };
      n += 1;
      const record: RefundRecord = {
        id: `re_scen_${n}`,
        status: pendingRefunds ? 'pending' : 'succeeded',
        amount: inr(input.amountMinor),
        chargeId: input.chargeId ?? null,
        paymentIntentId: null,
        reason: input.reason,
        created: nowSec(),
      };
      refunds.set(record.id, record);
      byKey.set(key, record);
      return { ...record };
    },
    cancelSubscription: async (input: CancelInput) => {
      const sub = subs.get(input.subscriptionId);
      if (!sub) throw notFound('subscription');
      const next: SubscriptionRecord =
        input.mode === 'immediate'
          ? { ...sub, status: 'canceled', canceledAt: nowSec() }
          : { ...sub, cancelAtPeriodEnd: true, cancelAt: sub.currentPeriodEnd };
      subs.set(input.subscriptionId, next);
      return { ...next };
    },
    changePlan: async (input: PlanChangeInput) => {
      const sub = subs.get(input.subscriptionId);
      if (!sub) throw notFound('subscription');
      const quoted = previewFor(input.subscriptionId).nextChargeMinor;
      const next: SubscriptionRecord = {
        ...sub,
        items: sub.items.map((item) =>
          item.subscriptionItemId === input.subscriptionItemId
            ? { ...item, priceId: input.targetPriceId, unitAmount: inr(quoted) }
            : item,
        ),
      };
      subs.set(input.subscriptionId, next);
      const inv = invoices.get(sub.latestInvoiceId ?? '');
      if (inv) invoices.set(inv.id, { ...inv, amountDue: inr(quoted) });
      return { ...next };
    },
    getRefund: async (id) => {
      const record = refunds.get(id);
      if (!record) throw notFound(`refund ${id}`);
      return { ...record };
    },
  };
}

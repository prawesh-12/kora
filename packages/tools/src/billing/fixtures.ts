import { stripeFixtureManifestSchema, type StripeFixtureManifest } from './manifest.js';

export const STUB_FROZEN_TIME = '2026-01-05T00:00:00.000Z';
export const DAY_MS = 86_400_000;

export interface FixtureCustomerInput {
  key: string;
  email: string;
  name: string;
}

export interface FixtureSubscriptionInput {
  key: string;
  customerId: string;
  priceId: string;
}

export interface FixtureChargeInput {
  key: string;
  customerId: string;
  subscriptionId: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
}

export interface FixtureBackend {
  readonly name: 'live' | 'stub';
  ensureTestClock(frozenTime: string): Promise<{ id: string }>;
  ensureCustomer(input: FixtureCustomerInput): Promise<{ id: string; paymentMethodId: string }>;
  ensureSubscription(input: FixtureSubscriptionInput): Promise<{ id: string; status: string }>;
  ensurePaidCharge(input: FixtureChargeInput): Promise<{ id: string; invoiceId: string }>;
  advanceClock(clockId: string, seconds: number): Promise<{ now: string }>;
  clockNow(clockId: string): Promise<{ now: string }>;
}

export interface FixtureStore {
  load(tenantId: string): Promise<unknown>;
  save(tenantId: string, manifest: Record<string, unknown>): Promise<void>;
}

export interface EnsureFixturesInput {
  tenantId: string;
  backend: FixtureBackend;
  store: FixtureStore;
  frozenTime: string;
  windowDays: number;
  priceIds: { basic: string; pro: string };
  currency?: string;
}

export function refundWindowStatus(args: {
  chargeCreatedAt: string | Date;
  evaluatedAt: string | Date;
  windowDays: number;
}): 'inside' | 'outside' {
  const elapsedDays = Math.floor(
    (new Date(args.evaluatedAt).getTime() - new Date(args.chargeCreatedAt).getTime()) / DAY_MS,
  );
  return elapsedDays <= args.windowDays ? 'inside' : 'outside';
}

function isoShift(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export async function ensureStripeFixtures(
  input: EnsureFixturesInput,
): Promise<{ manifest: StripeFixtureManifest; created: boolean }> {
  const stored = stripeFixtureManifestSchema.safeParse(await input.store.load(input.tenantId));
  if (
    stored.success &&
    stored.data.backend === input.backend.name &&
    stored.data.frozenTime === input.frozenTime &&
    stored.data.refundWindowDays === input.windowDays &&
    stored.data.priceIds.basic === input.priceIds.basic &&
    stored.data.priceIds.pro === input.priceIds.pro
  ) {
    return { manifest: stored.data, created: false };
  }

  const currency = input.currency ?? 'INR';
  const { id: testClockId } = await input.backend.ensureTestClock(input.frozenTime);

  const customerInputs: FixtureCustomerInput[] = [
    { key: 'recent-payer', email: 'recent-payer@kora.test', name: 'Recent Payer' },
    { key: 'borderline-payer', email: 'borderline-payer@kora.test', name: 'Borderline Payer' },
    { key: 'old-payer', email: 'old-payer@kora.test', name: 'Old Payer' },
  ];
  const customers = [];
  for (const c of customerInputs) {
    const created = await input.backend.ensureCustomer(c);
    customers.push({
      key: c.key,
      id: created.id,
      email: c.email,
      paymentMethodId: created.paymentMethodId,
    });
  }
  const customerByKey = new Map(customers.map((c) => [c.key, c]));

  const subscriptionInputs: FixtureSubscriptionInput[] = [
    {
      key: 'recent-sub',
      customerId: customerByKey.get('recent-payer')!.id,
      priceId: input.priceIds.basic,
    },
    {
      key: 'borderline-sub',
      customerId: customerByKey.get('borderline-payer')!.id,
      priceId: input.priceIds.basic,
    },
    { key: 'old-sub', customerId: customerByKey.get('old-payer')!.id, priceId: input.priceIds.pro },
  ];
  const subscriptions = [];
  for (const s of subscriptionInputs) {
    const created = await input.backend.ensureSubscription(s);
    subscriptions.push({ ...s, id: created.id, status: created.status });
  }
  const subscriptionByKey = new Map(subscriptions.map((s) => [s.key, s]));

  const chargeInputs: FixtureChargeInput[] = [
    {
      key: 'recent-charge',
      customerId: customerByKey.get('recent-payer')!.id,
      subscriptionId: subscriptionByKey.get('recent-sub')!.id,
      amountMinor: 349900,
      currency,
      createdAt: input.frozenTime,
    },
    {
      key: 'borderline-charge',
      customerId: customerByKey.get('borderline-payer')!.id,
      subscriptionId: subscriptionByKey.get('borderline-sub')!.id,
      amountMinor: 349900,
      currency,
      createdAt: isoShift(input.frozenTime, -20),
    },
    {
      key: 'old-charge',
      customerId: customerByKey.get('old-payer')!.id,
      subscriptionId: subscriptionByKey.get('old-sub')!.id,
      amountMinor: 899900,
      currency,
      createdAt: isoShift(input.frozenTime, -45),
    },
  ];
  const charges = [];
  for (const c of chargeInputs) {
    const created = await input.backend.ensurePaidCharge(c);
    charges.push({ ...c, id: created.id, invoiceId: created.invoiceId });
  }

  const manifest = stripeFixtureManifestSchema.parse({
    version: 1,
    backend: input.backend.name,
    testClockId,
    frozenTime: input.frozenTime,
    refundWindowDays: input.windowDays,
    priceIds: input.priceIds,
    customers,
    subscriptions: subscriptions.map((s) => ({
      key: s.key,
      id: s.id,
      customerId: s.customerId,
      priceId: s.priceId,
      status: s.status,
    })),
    charges,
  });
  await input.store.save(input.tenantId, manifest as unknown as Record<string, unknown>);
  return { manifest, created: true };
}

export class StubFixtureBackend implements FixtureBackend {
  readonly name = 'stub' as const;
  private clocks = new Map<string, { frozenTime: string; now: string }>();
  private customers = new Map<string, { id: string; paymentMethodId: string }>();
  private subscriptions = new Map<string, { id: string; status: string }>();
  private charges = new Map<string, { id: string; invoiceId: string }>();
  private seq = 0;
  readonly calls: Record<string, number> = {};

  private count(name: string): void {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_stub_${this.seq}`;
  }

  async ensureTestClock(frozenTime: string): Promise<{ id: string }> {
    this.count('ensureTestClock');
    const existing = [...this.clocks.entries()].find(([, c]) => c.frozenTime === frozenTime);
    if (existing) return { id: existing[0] };
    const id = this.nextId('tc');
    this.clocks.set(id, { frozenTime, now: frozenTime });
    return { id };
  }

  async ensureCustomer(
    input: FixtureCustomerInput,
  ): Promise<{ id: string; paymentMethodId: string }> {
    this.count('ensureCustomer');
    const existing = this.customers.get(input.key);
    if (existing) return existing;
    const created = { id: this.nextId('cus'), paymentMethodId: this.nextId('pm') };
    this.customers.set(input.key, created);
    return created;
  }

  async ensureSubscription(
    input: FixtureSubscriptionInput,
  ): Promise<{ id: string; status: string }> {
    this.count('ensureSubscription');
    const existing = this.subscriptions.get(input.key);
    if (existing) return existing;
    const created = { id: this.nextId('sub'), status: 'active' };
    this.subscriptions.set(input.key, created);
    return created;
  }

  async ensurePaidCharge(input: FixtureChargeInput): Promise<{ id: string; invoiceId: string }> {
    this.count('ensurePaidCharge');
    const existing = this.charges.get(input.key);
    if (existing) return existing;
    const created = { id: this.nextId('ch'), invoiceId: this.nextId('in') };
    this.charges.set(input.key, created);
    return created;
  }

  async advanceClock(clockId: string, seconds: number): Promise<{ now: string }> {
    this.count('advanceClock');
    const clock = this.clocks.get(clockId);
    if (!clock) throw new Error(`unknown test clock ${clockId}`);
    clock.now = new Date(new Date(clock.now).getTime() + seconds * 1000).toISOString();
    return { now: clock.now };
  }

  async clockNow(clockId: string): Promise<{ now: string }> {
    const clock = this.clocks.get(clockId);
    if (!clock) throw new Error(`unknown test clock ${clockId}`);
    return { now: clock.now };
  }
}

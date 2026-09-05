import { compilePolicyBundle, logger, now } from '@kora/core';
import { type RunHandle, closeDb, sql, startRun, withTenant } from '@kora/db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecuteToolArgs } from '../src/pipeline.js';
import type {
  ChargeRecord,
  CustomerRecord,
  InvoiceRecord,
  SubscriptionRecord,
} from '../src/billing/types.js';
import { setBillingProvider } from '../src/billing/provider.js';
import { setTenantStripeKey } from '../src/billing/tenant-keys.js';
import { closeBreaker } from '../src/breaker.js';
import { registry } from '../src/tools/index.js';
import { FakeBillingProvider } from './fake-billing.js';

export const TENANT = 'ten_pipeline_test';

const POLICY_FILES = ['refunds', 'cancellations', 'plan-changes'];

export const policy = compilePolicyBundle(
  POLICY_FILES.map((name) => ({
    key: name,
    yaml: readFileSync(join(import.meta.dirname, `../../../config/policies/${name}.yaml`), 'utf8'),
  })),
);

export const ALL_TOOLS = registry.list().map((t) => ({ name: t.name, version: t.version }));
export const ALL_PERMISSIONS = registry.list().map((t) => t.requiredPermission);

const NOW_S = Math.floor(now().getTime() / 1000);
const DAY_S = 86_400;

export const CUSTOMER: CustomerRecord = {
  id: 'cus_014',
  email: 'ravi@example.test',
  name: 'Ravi',
  defaultPaymentMethodId: 'pm_1S',
  currency: 'INR',
};

export const SUBSCRIPTION: SubscriptionRecord = {
  id: 'sub_1S',
  status: 'active',
  customerId: CUSTOMER.id,
  items: [
    {
      subscriptionItemId: 'si_1S',
      priceId: 'price_basic',
      productId: 'prod_basic',
      unitAmount: { amountMinor: 349900, currency: 'INR' },
      quantity: 1,
    },
  ],
  currentPeriodEnd: NOW_S + 26 * DAY_S,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  cancelAt: null,
  latestInvoiceId: 'in_1S',
  collectionMethod: 'charge_automatically',
};

/** Same shape, bigger money, so the high-value approval rule can be reached. */
export const BIG_SUBSCRIPTION: SubscriptionRecord = {
  ...SUBSCRIPTION,
  id: 'sub_2S',
  items: [
    {
      ...SUBSCRIPTION.items[0]!,
      subscriptionItemId: 'si_2S',
      unitAmount: { amountMinor: 1_200_000, currency: 'INR' },
    },
  ],
  latestInvoiceId: 'in_2S',
};

function invoice(id: string, subscriptionId: string, amountMinor: number): InvoiceRecord {
  return {
    id,
    status: 'paid',
    customerId: CUSTOMER.id,
    subscriptionId,
    amountDue: { amountMinor, currency: 'INR' },
    amountPaid: { amountMinor, currency: 'INR' },
    amountRemaining: { amountMinor: 0, currency: 'INR' },
    paymentIntentId: `pi_${id}`,
    chargeId: `ch_${id}`,
    created: NOW_S - 5 * DAY_S,
  };
}

function charge(invoiceId: string, amountMinor: number, daysAgo: number): ChargeRecord {
  return {
    id: `ch_${invoiceId}`,
    amountCaptured: { amountMinor, currency: 'INR' },
    amountRefunded: { amountMinor: 0, currency: 'INR' },
    remainingRefundable: { amountMinor, currency: 'INR' },
    currency: 'INR',
    paymentIntentId: `pi_${invoiceId}`,
    invoiceId,
    customerId: CUSTOMER.id,
    created: NOW_S - daysAgo * DAY_S,
    refunded: false,
  };
}

export const INVOICE = invoice('in_1S', SUBSCRIPTION.id, 349900);
export const BIG_INVOICE = invoice('in_2S', BIG_SUBSCRIPTION.id, 1_200_000);
export const OLD_INVOICE = invoice('in_3S', SUBSCRIPTION.id, 349900);

export const CHARGE = charge('in_1S', 349900, 5);
export const BIG_CHARGE = charge('in_2S', 1_200_000, 5);
/** Paid 45 days ago, so it falls outside the 30-day refund window. */
export const OLD_CHARGE = charge('in_3S', 349900, 45);

export const PREVIEW = {
  lines: [{ amountMinor: -12_000, description: 'Unused time on basic', proration: true }],
  prorationCreditMinor: 12_000,
  nextChargeMinor: 5000,
  currency: 'INR',
};

export function installFakeBilling(): FakeBillingProvider {
  const provider = new FakeBillingProvider({
    customers: [CUSTOMER],
    subscriptions: [SUBSCRIPTION, BIG_SUBSCRIPTION],
    invoices: [INVOICE, BIG_INVOICE, OLD_INVOICE],
    charges: [CHARGE, BIG_CHARGE, OLD_CHARGE],
    preview: PREVIEW,
  });
  setBillingProvider(provider);
  return provider;
}

export function resetBilling(): void {
  setBillingProvider(null);
}

export async function ensureTenant(): Promise<void> {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Pipeline test')
              ON CONFLICT (id) DO NOTHING`;
  // The pipeline gates money writes on the tenant having a key. The fake provider
  // never reads it, but without a row the gate stops every write before it runs.
  await setTenantStripeKey(TENANT, 'sk_test_pipeline');
}

export async function cleanupTenant(): Promise<void> {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tickets WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM conversations WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeBreaker();
  await closeDb();
}

export async function resetRunState(): Promise<void> {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tickets WHERE tenant_id = ${TENANT}`;
}

export async function newRun(): Promise<{ run: RunHandle; conversationId: string }> {
  const conv = await withTenant(TENANT).conversations.create({ externalCustomerId: CUSTOMER.id });
  const run = await startRun({
    tenantId: TENANT,
    conversationId: conv.id,
    agentConfigVersion: 'test-config',
  });
  return { run, conversationId: conv.id };
}

export function argsFor(
  toolName: string,
  rawInput: unknown,
  run: RunHandle,
  conversationId: string,
  overrides: Partial<ExecuteToolArgs> = {},
): ExecuteToolArgs {
  const tool = registry.get(toolName, 1);
  return {
    tool,
    rawInput,
    policy,
    deploymentMode: 'full',
    allowedTools: ALL_TOOLS,
    grantedPermissions: ALL_PERMISSIONS,
    gathered: { subscription: SUBSCRIPTION, charge: CHARGE },
    run,
    ctx: {
      tenantId: TENANT,
      conversationId,
      runId: run.runId,
      traceId: run.traceId,
      agentConfigVersion: 'test-config',
      actorId: 'agent',
      deadlineAt: new Date(now().getTime() + 30_000),
      logger: logger().child({ test: true }),
    },
    ...overrides,
  };
}

import type { BillingProvider } from './types.js';
import { StripeBillingProvider } from './stripe-provider.js';
import { requireTenantStripeKey } from './tenant-keys.js';

let override: BillingProvider | null = null;
const byTenant = new Map<string, BillingProvider>();

/**
 * Replaces the real provider for every tenant. Tests and the scenario runner use
 * this; nothing in the running app does.
 */
export function setBillingProvider(next: BillingProvider | null): void {
  override = next;
  byTenant.clear();
}

/**
 * A provider is per tenant because `StripeBillingProvider` caches the Stripe
 * client it builds from that tenant's key. One shared instance would serve every
 * tenant with whichever key happened to be resolved first.
 *
 * The cache lives for the life of the process, so a key rotated through
 * `kora stripe:set-key` (a separate process) is only picked up on restart.
 */
export function billingProvider(tenantId: string): BillingProvider {
  if (override) return override;

  const existing = byTenant.get(tenantId);
  if (existing) return existing;

  const provider = new StripeBillingProvider({
    resolveKey: () => requireTenantStripeKey(tenantId),
  });
  byTenant.set(tenantId, provider);
  return provider;
}

export function resolveChargeForInvoice(tenantId: string, invoiceId: string) {
  return billingProvider(tenantId).resolveChargeForInvoice(invoiceId);
}

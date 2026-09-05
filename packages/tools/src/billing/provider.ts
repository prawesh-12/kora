import { ToolError } from '@kora/core';
import type { BillingProvider } from './types.js';

let current: BillingProvider | null = null;

export function setBillingProvider(next: BillingProvider | null): void {
  current = next;
}

export function billingProvider(): BillingProvider {
  if (!current) {
    throw new ToolError('no billing provider is wired in, so no billing tool can run', {
      code: 'CONFIG_ERROR',
      retryable: false,
    });
  }
  return current;
}

export function resolveChargeForInvoice(invoiceId: string) {
  return billingProvider().resolveChargeForInvoice(invoiceId);
}

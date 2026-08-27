import { acme, acmeFetch } from './clients/acme.js';
import type {
  CancellationResponse,
  OrderResponse,
  RefundResponse,
  ReplacementResponse,
} from './clients/acme.js';

const TIMEOUT_MS = 5000;

/**
 * Read-only access to the business system for the evaluator, which runs after a
 * run has finished and must never write. Reads still go through the same typed
 * client, so nothing outside this package talks to Acme directly.
 */
export const acmeReader = {
  async getOrderOrNull(id: string): Promise<OrderResponse | null> {
    try {
      return await acme.getOrder(id, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if ((e as { code?: string }).code === 'UPSTREAM_4XX') return null;
      throw e;
    }
  },

  listReplacements(orderId: string): Promise<ReplacementResponse[]> {
    return acme.listReplacements(orderId, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  },

  listRefunds(orderId: string): Promise<RefundResponse[]> {
    return acme.listRefunds(orderId, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  },

  listCancellations(orderId: string): Promise<CancellationResponse[]> {
    return acme.listCancellations(orderId, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  },
};

/**
 * Scenario-support calls. They are Acme HTTP calls like any other, so they live
 * behind the same client rather than letting the test harness reach the business
 * API directly.
 */
export const acmeAdmin = {
  async health(): Promise<boolean> {
    try {
      return (await acmeFetch('/health', { method: 'GET' }, 2000)).ok;
    } catch {
      return false;
    }
  },

  async reset(orderIds?: string[]): Promise<void> {
    await acmeFetch(
      '/admin/reset',
      { method: 'POST', body: JSON.stringify(orderIds ? { orderIds } : {}) },
      10_000,
    );
  },

  /** `null` hands control back to the service's own `ACME_FAULT_RATE`. */
  async setFaultRate(rate: number | null): Promise<void> {
    await acmeFetch('/admin/fault-rate', { method: 'POST', body: JSON.stringify({ rate }) }, 5000);
  },

  async requestLog(path: string): Promise<AcmeRequestLogEntry[]> {
    const r = await acmeFetch(`/admin/request-log?path=${encodeURIComponent(path)}`, {}, 5000);
    if (!r.ok) return [];
    return ((await r.json()) as { entries?: AcmeRequestLogEntry[] }).entries ?? [];
  },

  async orderStatus(id: string): Promise<string | null> {
    const order = await acmeReader.getOrderOrNull(id);
    return order?.status ?? null;
  },
};

export interface AcmeRequestLogEntry {
  id: number;
  method: string;
  path: string;
  idempotencyKey: string | null;
  fault: string | null;
  reachedBusinessLogic: boolean;
  createdAt: string;
}

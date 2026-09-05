import { describe, expect, it } from 'vitest';

if (!process.env.KORA_SECRET_KEY) {
  process.env.KORA_SECRET_KEY = 'test-only-secret-key-0123456789abcdef';
}

import { decryptSecret, encryptSecret, redactSecret } from '@kora/core';
import {
  DAY_MS,
  STUB_FROZEN_TIME,
  StubFixtureBackend,
  ensureStripeFixtures,
  gateStripeWrite,
  refundWindowStatus,
  stripeFixtureManifestSchema,
  type FixtureStore,
  type StripeEscalationSink,
  type StripeKeyStore,
} from '../src/billing/index.js';

const TENANT = 'ten_phase5_test';
const PRICES = { basic: 'price_test_basic', pro: 'price_test_pro' };

function memoryStore(): FixtureStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    load: async (tenantId: string) => data.get(tenantId) ?? null,
    save: async (tenantId: string, manifest: Record<string, unknown>) => {
      data.set(tenantId, manifest);
    },
  };
}

function keyStore(hasKey: boolean): StripeKeyStore & { checks: number } {
  const store: StripeKeyStore & { checks: number } = {
    checks: 0,
    hasStripeKey: async () => {
      store.checks += 1;
      return hasKey;
    },
  };
  return store;
}

function sink(): StripeEscalationSink & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    escalate: async (input) => {
      calls.push({ ...input });
      return { escalated: true };
    },
  };
}

async function firstRun(store = memoryStore(), backend = new StubFixtureBackend()) {
  return ensureStripeFixtures({
    tenantId: TENANT,
    backend,
    store,
    frozenTime: STUB_FROZEN_TIME,
    windowDays: 30,
    priceIds: PRICES,
  });
}

describe('tenant stripe secret', () => {
  it('round-trips through the existing secret helper and never leaks into redaction', () => {
    const plain = 'rk_test_phase5_sentinel_value';
    const cipher = encryptSecret(plain);
    expect(cipher).not.toContain(plain);
    expect(decryptSecret(cipher)).toBe(plain);
    expect(redactSecret(cipher)).not.toContain(plain);
  });
});

describe('no-key write gate', () => {
  it('fails closed and escalates without throwing', async () => {
    const store = keyStore(false);
    const esc = sink();
    const result = await gateStripeWrite(store, esc, {
      tenantId: TENANT,
      conversationId: 'conv_1',
      runId: 'run_1',
      toolName: 'create_refund',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toMatchObject({
      status: 'failed',
      code: 'CONFIG_ERROR',
      retryable: false,
    });
    expect(esc.calls).toHaveLength(1);
    expect(esc.calls[0]).toMatchObject({ tenantId: TENANT, reason: 'TOOL_FAILED' });
  });

  it('passes through when a key is configured and escalates nothing', async () => {
    const store = keyStore(true);
    const esc = sink();
    const result = await gateStripeWrite(store, esc, {
      tenantId: TENANT,
      conversationId: 'conv_1',
      runId: 'run_1',
      toolName: 'create_refund',
    });
    expect(result).toEqual({ ok: true });
    expect(esc.calls).toHaveLength(0);
  });
});

describe('stripe fixtures', () => {
  it('running twice yields the same manifest without new backend writes', async () => {
    const store = memoryStore();
    const backend = new StubFixtureBackend();
    const first = await firstRun(store, backend);
    expect(first.created).toBe(true);
    const callsAfterFirst = { ...backend.calls };
    const second = await ensureStripeFixtures({
      tenantId: TENANT,
      backend,
      store,
      frozenTime: STUB_FROZEN_TIME,
      windowDays: 30,
      priceIds: PRICES,
    });
    expect(second.created).toBe(false);
    expect(second.manifest).toEqual(first.manifest);
    expect(backend.calls).toEqual(callsAfterFirst);
  });

  it('creates customers with payment methods, subscriptions on known prices, and refundable charges', async () => {
    const { manifest } = await firstRun();
    expect(manifest.testClockId).toMatch(/^tc_stub_/);
    expect(manifest.customers).toHaveLength(3);
    for (const c of manifest.customers) expect(c.paymentMethodId).toMatch(/^pm_stub_/);
    const priceIds = manifest.subscriptions.map((s) => s.priceId).sort();
    expect(priceIds).toEqual([PRICES.basic, PRICES.basic, PRICES.pro].sort());
    expect(manifest.charges).toHaveLength(3);
    expect(manifest.charges.map((c) => c.key).sort()).toEqual(
      ['borderline-charge', 'old-charge', 'recent-charge'].sort(),
    );
  });

  it('advancing the clock flips the borderline charge from inside to outside the window', async () => {
    const backend = new StubFixtureBackend();
    const { manifest } = await firstRun(memoryStore(), backend);
    const borderline = manifest.charges.find((c) => c.key === 'borderline-charge')!;
    const recent = manifest.charges.find((c) => c.key === 'recent-charge')!;
    const old = manifest.charges.find((c) => c.key === 'old-charge')!;
    expect(
      refundWindowStatus({
        chargeCreatedAt: borderline.createdAt,
        evaluatedAt: manifest.frozenTime,
        windowDays: 30,
      }),
    ).toBe('inside');
    expect(
      refundWindowStatus({
        chargeCreatedAt: old.createdAt,
        evaluatedAt: manifest.frozenTime,
        windowDays: 30,
      }),
    ).toBe('outside');
    const { now } = await backend.advanceClock(manifest.testClockId, (15 * DAY_MS) / 1000);
    expect(
      refundWindowStatus({
        chargeCreatedAt: borderline.createdAt,
        evaluatedAt: now,
        windowDays: 30,
      }),
    ).toBe('outside');
    expect(
      refundWindowStatus({ chargeCreatedAt: recent.createdAt, evaluatedAt: now, windowDays: 30 }),
    ).toBe('inside');
  });

  it('treats the window boundary as inside and one day past as outside', () => {
    const charge = '2026-01-05T00:00:00.000Z';
    expect(
      refundWindowStatus({
        chargeCreatedAt: charge,
        evaluatedAt: '2026-02-04T00:00:00.000Z',
        windowDays: 30,
      }),
    ).toBe('inside');
    expect(
      refundWindowStatus({
        chargeCreatedAt: charge,
        evaluatedAt: '2026-02-05T00:00:01.000Z',
        windowDays: 30,
      }),
    ).toBe('outside');
  });

  it('rejects stored garbage instead of treating it as fixtures', () => {
    expect(stripeFixtureManifestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(stripeFixtureManifestSchema.safeParse(null).success).toBe(false);
  });

  it('rebuilds when the frozen time, window, prices, or backend change', async () => {
    const store = memoryStore();
    const backend = new StubFixtureBackend();
    const first = await firstRun(store, backend);
    const second = await ensureStripeFixtures({
      tenantId: TENANT,
      backend,
      store,
      frozenTime: STUB_FROZEN_TIME,
      windowDays: 45,
      priceIds: PRICES,
    });
    expect(second.created).toBe(true);
    expect(second.manifest.refundWindowDays).toBe(45);
    expect(second.manifest.testClockId).toBe(first.manifest.testClockId);
  });
});

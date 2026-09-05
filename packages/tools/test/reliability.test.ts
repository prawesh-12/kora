import { randomUUID } from 'node:crypto';
import { sql } from '@kora/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type GatedBreaker,
  breaker,
  closeBreaker,
  createBreaker,
  setBreaker,
  toolBreakerKey,
} from '../src/breaker.js';
import { executeTool } from '../src/pipeline.js';
import {
  SUBSCRIPTION,
  TENANT,
  argsFor,
  cleanupTenant,
  ensureTenant,
  installFakeBilling,
  newRun,
  resetBilling,
  resetRunState,
} from './helpers.js';
import type { FakeBillingProvider } from './fake-billing.js';

const DEAD_REDIS_URL = 'redis://127.0.0.1:6390';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Distinct amounts, so each call claims its own idempotency key. */
function refundOf(amountMinor: number) {
  return {
    subscriptionId: SUBSCRIPTION.id,
    invoiceId: 'in_1S',
    amountMinor,
    reason: 'requested_by_customer' as const,
  };
}

let billing: FakeBillingProvider;

beforeAll(ensureTenant);

beforeEach(async () => {
  billing = installFakeBilling();
  await resetRunState();
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'create_refund'));
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'get_subscription'));
});

afterEach(async () => {
  resetBilling();
  setBreaker(null);
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'create_refund'));
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'get_subscription'));
});

afterAll(cleanupTenant);

describe('circuit breaker', () => {
  it('opens after five failed calls and the sixth never reaches the provider', async () => {
    const { run, conversationId } = await newRun();

    billing.fault = '500';
    for (const amountMinor of [1000, 2000, 3000, 4000, 5000]) {
      const outcome = await executeTool(
        argsFor('create_refund', refundOf(amountMinor), run, conversationId),
      );
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_5XX');
    }

    expect(await breaker().state(toolBreakerKey(TENANT, 'create_refund'))).toBe('open');

    billing.fault = null;
    const before = billing.calls.length;
    const sixth = await executeTool(
      argsFor('create_refund', refundOf(6000), run, conversationId),
    );

    expect(sixth.status).toBe('failed');
    if (sixth.status === 'failed') {
      expect(sixth.code).toBe('UPSTREAM_5XX');
      expect(sixth.retryable).toBe(false);
      expect(sixth.error).toContain('paused');
    }
    expect(billing.calls).toHaveLength(before);

    const rows = await sql()<{ error_message: string }[]>`
      SELECT error_message FROM tool_executions
      WHERE run_id = ${run.runId} AND tool_name = 'create_refund'
      ORDER BY id DESC LIMIT 1`;
    expect(rows[0]?.error_message).toContain('paused');
  }, 90_000);

  it('half-opens after the open window, closes on a good probe and re-opens on a bad one', async () => {
    const b = createBreaker({ openMs: 150, failureThreshold: 5, windowMs: 60_000 });
    const key = `test:${randomUUID()}`;
    try {
      for (let i = 0; i < 4; i++) await b.recordFailure(key);
      expect(await b.state(key)).toBe('closed');

      await b.recordFailure(key);
      expect(await b.state(key)).toBe('open');

      await sleep(200);
      expect(await b.state(key)).toBe('half_open');

      await b.recordFailure(key);
      expect(await b.state(key)).toBe('open');

      await sleep(200);
      expect(await b.state(key)).toBe('half_open');

      await b.recordSuccess(key);
      expect(await b.state(key)).toBe('closed');
    } finally {
      await b.recordSuccess(key);
      await b.close();
    }
  });

  it('forgets failures that fall out of the window', async () => {
    const b = createBreaker({ openMs: 150, failureThreshold: 5, windowMs: 150 });
    const key = `test:${randomUUID()}`;
    try {
      for (let i = 0; i < 4; i++) await b.recordFailure(key);
      await sleep(200);
      await b.recordFailure(key);
      expect(await b.state(key)).toBe('closed');
    } finally {
      await b.recordSuccess(key);
      await b.close();
    }
  });

  it('lets a write through once the breaker is closed again', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('create_refund', refundOf(7000), run, conversationId),
    );
    expect(outcome.status).toBe('ok');
    expect(await breaker().state(toolBreakerKey(TENANT, 'create_refund'))).toBe('closed');
  });
});

describe('redis down', () => {
  let dead: GatedBreaker;

  beforeEach(() => {
    dead = createBreaker({ redisUrl: DEAD_REDIS_URL });
    setBreaker(dead);
  });

  afterEach(async () => {
    await dead.close();
  });

  it('blocks a write rather than executing it', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('create_refund', refundOf(8000), run, conversationId),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.code).toBe('UPSTREAM_5XX');
      expect(outcome.error).toContain('unreachable');
    }
    expect(billing.calls).toHaveLength(0);

    const claims = await sql()<{ count: string }[]>`
      SELECT count(*)::text AS count FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
    expect(claims[0]?.count).toBe('0');
  }, 30_000);

  it('lets a read through', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId),
    );
    expect(outcome.status).toBe('ok');
  }, 30_000);
});

afterAll(closeBreaker);

describe('listing open breakers', () => {
  it('reports how long each has been open, and nothing when all are closed', async () => {
    const local = createBreaker({ failureThreshold: 2, windowMs: 60_000, openMs: 30_000 });
    const key = `tool:${TENANT}:list_probe_${randomUUID().slice(0, 8)}`;

    try {
      expect((await local.listOpen()).some((b) => b.key === key)).toBe(false);

      await local.recordFailure(key);
      await local.recordFailure(key);

      const open = await local.listOpen();
      const found = open.find((b) => b.key === key);
      expect(found, 'an open breaker was not listed').toBeDefined();
      expect(found?.openForMs).toBeGreaterThanOrEqual(0);

      await local.recordSuccess(key);
      expect((await local.listOpen()).some((b) => b.key === key)).toBe(false);
    } finally {
      await local.close();
    }
  });

  it('measures from when the dependency went down, not from the last probe', async () => {
    const local = createBreaker({ failureThreshold: 1, windowMs: 60_000, openMs: 20 });
    const key = `tool:${TENANT}:since_probe_${randomUUID().slice(0, 8)}`;

    try {
      await local.recordFailure(key);
      await sleep(60);
      // A failed probe re-opens the breaker but must not reset how long it has
      // been down, or a flapping dependency never looks stuck.
      await local.recordFailure(key);

      const found = (await local.listOpen()).find((b) => b.key === key);
      expect(found?.openForMs).toBeGreaterThanOrEqual(50);
    } finally {
      await local.close();
    }
  });
});

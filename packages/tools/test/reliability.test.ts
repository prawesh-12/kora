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
  TENANT,
  acmeRequestLog,
  acmeUp,
  argsFor,
  cleanupTenant,
  ensureTenant,
  newRun,
  resetAcme,
} from './helpers.js';

const DEAD_REDIS_URL = 'redis://127.0.0.1:6390';
const ORDER_IDS = ['9832', '9833', '9834', '9835', '9836'];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function replacementInput(orderId: string) {
  return {
    orderId,
    items: [{ sku: 'SKU-CM-01', quantity: 1 }],
    reason: 'damaged' as const,
  };
}

beforeAll(async () => {
  if (!(await acmeUp())) {
    throw new Error('the acme mock commerce service is not running on ACME_BASE_URL');
  }
  await ensureTenant();
});

beforeEach(async () => {
  await resetAcme(ORDER_IDS);
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'create_replacement'));
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'get_order'));
});

afterEach(async () => {
  setBreaker(null);
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'create_replacement'));
  await breaker().recordSuccess(toolBreakerKey(TENANT, 'get_order'));
});

afterAll(cleanupTenant);

describe('circuit breaker', () => {
  it('opens after five failed calls and the sixth never reaches acme', async () => {
    const { run, conversationId } = await newRun();

    for (const orderId of ORDER_IDS) {
      const args = argsFor('create_replacement', replacementInput(orderId), run, conversationId);
      args.ctx.fault = '500';
      const outcome = await executeTool(args);
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') expect(outcome.code).toBe('UPSTREAM_5XX');
    }

    expect(await breaker().state(toolBreakerKey(TENANT, 'create_replacement'))).toBe('open');

    const before = (await acmeRequestLog('/replacements')).length;
    const sixth = await executeTool(
      argsFor('create_replacement', replacementInput('9837'), run, conversationId),
    );

    expect(sixth.status).toBe('failed');
    if (sixth.status === 'failed') {
      expect(sixth.code).toBe('UPSTREAM_5XX');
      expect(sixth.retryable).toBe(false);
      expect(sixth.error).toContain('paused');
    }
    expect((await acmeRequestLog('/replacements')).length).toBe(before);

    const rows = await sql()<{ error_message: string }[]>`
      SELECT error_message FROM tool_executions
      WHERE run_id = ${run.runId} AND tool_name = 'create_replacement'
      ORDER BY id DESC LIMIT 1`;
    expect(rows[0]?.error_message).toContain('paused');
  });

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
      argsFor('create_replacement', replacementInput('9832'), run, conversationId),
    );
    expect(outcome.status).toBe('ok');
    expect(await breaker().state(toolBreakerKey(TENANT, 'create_replacement'))).toBe('closed');
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
    const before = (await acmeRequestLog('/replacements')).length;

    const outcome = await executeTool(
      argsFor('create_replacement', replacementInput('9832'), run, conversationId),
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.code).toBe('UPSTREAM_5XX');
      expect(outcome.error).toContain('unreachable');
    }
    expect((await acmeRequestLog('/replacements')).length).toBe(before);

    const claims = await sql()<{ count: string }[]>`
      SELECT count(*)::text AS count FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
    expect(claims[0]?.count).toBe('0');
  }, 30_000);

  it('lets a read through', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('get_order', { orderId: '9832' }, run, conversationId),
    );
    expect(outcome.status).toBe('ok');
  }, 30_000);
});

afterAll(closeBreaker);

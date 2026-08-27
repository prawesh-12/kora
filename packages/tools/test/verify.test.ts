import { sql, withTenant } from '@kora/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeTool } from '../src/pipeline.js';
import {
  TENANT,
  acmeUp,
  argsFor,
  cleanupTenant,
  ensureTenant,
  newRun,
  resetAcme,
} from './helpers.js';

const REPLACEMENT_INPUT = {
  orderId: '9832',
  items: [{ sku: 'SKU-CM-01', quantity: 1 }],
  reason: 'damaged' as const,
};

beforeAll(async () => {
  if (!(await acmeUp())) throw new Error('acme mock commerce is not running');
  await ensureTenant();
});

beforeEach(async () => {
  await resetAcme(['9832']);
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
});

afterAll(cleanupTenant);

async function createWithFault(fault?: string) {
  const { run, conversationId } = await newRun();
  const args = argsFor('create_replacement', REPLACEMENT_INPUT, run, conversationId);
  if (fault) args.ctx.fault = fault;
  const outcome = await executeTool(args);
  const rows = await withTenant(TENANT).toolExecutions.listForRun(run.runId);
  return { outcome, rows, run };
}

describe('post-condition verification', () => {
  it('verifies a real write by reading it back', async () => {
    const { outcome, rows } = await createWithFault();
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.verified).toBe(true);
    expect(rows[0]?.verified).toBe(true);
    expect(rows[0]?.verifyObserved).not.toBeNull();
  });

  it('fails verification when the write does not show up on read-back', async () => {
    const { outcome, rows } = await createWithFault('stale');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.verified).toBe(false);
    expect(rows[0]?.verified).toBe(false);
    expect(rows[0]?.errorCode).toBe('VERIFY_FAILED');
    expect(rows[0]?.errorMessage).toBe('replacement_not_found');
  });

  it('flags a duplicate detected on read-back', async () => {
    const { outcome, rows } = await createWithFault('duplicate');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.verified).toBe(false);
    expect(rows[0]?.errorMessage).toBe('duplicate_detected');
  });

  it('stores verified as null for a read tool that has no verify', async () => {
    const { run, conversationId } = await newRun();
    const outcome = await executeTool(
      argsFor('get_order', { orderId: '9832' }, run, conversationId),
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.verified).toBeNull();

    const rows = await withTenant(TENANT).toolExecutions.listForRun(run.runId);
    expect(rows[0]?.verified).toBeNull();
  });

  it('never claims a replacement id when verification failed', async () => {
    const { outcome } = await createWithFault('stale');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      // The output still exists for the trace, but the caller can see it is unverified
      // and must not repeat the id to the customer. The grounding guard enforces that.
      expect(outcome.verified).toBe(false);
    }
  });
});

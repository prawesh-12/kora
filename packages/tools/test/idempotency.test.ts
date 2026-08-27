import { sql } from '@kora/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claim,
  cleanupExpired,
  deriveKey,
  requestHash,
  settleFailure,
  settleSuccess,
} from '../src/idempotency.js';
import { TENANT, cleanupTenant, ensureTenant } from './helpers.js';

const base = {
  tenantId: TENANT,
  conversationId: 'conv_test',
  runId: 'run_test',
  toolName: 'create_replacement',
  toolVersion: 1,
};

beforeAll(ensureTenant);
beforeEach(async () => {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
});
afterAll(cleanupTenant);

describe('deriveKey', () => {
  it('is stable across key ordering in the input object', () => {
    const a = deriveKey({ ...base, input: { orderId: '9832', reason: 'damaged' } });
    const b = deriveKey({ ...base, input: { reason: 'damaged', orderId: '9832' } });
    expect(a).toBe(b);
  });

  it('changes when the input changes, because that is a different action', () => {
    const a = deriveKey({ ...base, input: { orderId: '9832' } });
    const b = deriveKey({ ...base, input: { orderId: '9833' } });
    expect(a).not.toBe(b);
  });

  it('changes when the tool version changes', () => {
    const a = deriveKey({ ...base, input: { orderId: '9832' } });
    const b = deriveKey({ ...base, toolVersion: 2, input: { orderId: '9832' } });
    expect(a).not.toBe(b);
  });
});

describe('claim', () => {
  it('gives exactly one of 20 parallel callers the claim', async () => {
    const key = deriveKey({ ...base, input: { orderId: 'parallel' } });
    const args = { key, tenantId: TENANT, scope: 'x', requestHash: requestHash({}), maxRetries: 2 };

    // Settle shortly after the owner takes it, so the waiters replay rather than
    // sitting out the full 5 second poll.
    const settleSoon = (async () => {
      await new Promise((r) => setTimeout(r, 300));
      await settleSuccess(key, { id: 'REP-0001' });
    })();

    const claims = await Promise.all(Array.from({ length: 20 }, () => claim(args)));
    await settleSoon;

    expect(claims.filter((c) => c.kind === 'owned')).toHaveLength(1);
    const replayed = claims.filter((c) => c.kind === 'replayed');
    expect(replayed.length).toBe(19);
    for (const r of replayed) {
      if (r.kind === 'replayed') expect(r.response).toEqual({ id: 'REP-0001' });
    }
  }, 30_000);

  it('lets both run when the inputs differ', async () => {
    const a = deriveKey({ ...base, input: { orderId: '9832' } });
    const b = deriveKey({ ...base, input: { orderId: '9833' } });
    const args = (key: string) => ({
      key,
      tenantId: TENANT,
      scope: 'x',
      requestHash: requestHash({}),
      maxRetries: 2,
    });
    expect((await claim(args(a))).kind).toBe('owned');
    expect((await claim(args(b))).kind).toBe('owned');
  });

  it('re-claims a failure below maxRetries and returns the stored failure at the cap', async () => {
    const key = deriveKey({ ...base, input: { orderId: 'retry' } });
    const args = { key, tenantId: TENANT, scope: 'x', requestHash: requestHash({}), maxRetries: 2 };

    expect((await claim(args)).kind).toBe('owned');
    await settleFailure(key, 'UPSTREAM_5XX');

    const second = await claim(args);
    expect(second.kind).toBe('owned');
    if (second.kind === 'owned') expect(second.attempt).toBe(2);
    await settleFailure(key, 'UPSTREAM_5XX');

    const third = await claim(args);
    expect(third.kind).toBe('owned');
    if (third.kind === 'owned') expect(third.attempt).toBe(3);
    await settleFailure(key, 'UPSTREAM_5XX');

    const fourth = await claim(args);
    expect(fourth.kind).toBe('failed');
    if (fourth.kind === 'failed') expect(fourth.errorCode).toBe('UPSTREAM_5XX');
  });

  it('replays a settled success without executing again', async () => {
    const key = deriveKey({ ...base, input: { orderId: 'settled' } });
    const args = { key, tenantId: TENANT, scope: 'x', requestHash: requestHash({}), maxRetries: 2 };
    await claim(args);
    await settleSuccess(key, { id: 'REP-0009' });

    const again = await claim(args);
    expect(again.kind).toBe('replayed');
    if (again.kind === 'replayed') expect(again.response).toEqual({ id: 'REP-0009' });
  });
});

describe('cleanup', () => {
  it('deletes rows past their expiry', async () => {
    const key = deriveKey({ ...base, input: { orderId: 'expired' } });
    await claim({ key, tenantId: TENANT, scope: 'x', requestHash: requestHash({}), maxRetries: 0 });
    await sql()`UPDATE idempotency_keys SET expires_at = now() - '1 hour'::interval WHERE key = ${key}`;

    expect(await cleanupExpired()).toBeGreaterThanOrEqual(1);
    const rows = await sql()`SELECT key FROM idempotency_keys WHERE key = ${key}`;
    expect(rows).toHaveLength(0);
  });
});

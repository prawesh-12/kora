import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, resetOrder, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

const validBody = (idempotencyKey: string, orderId = '9832') => ({
  orderId,
  items: [{ sku: 'SKU-CM-01', quantity: 1 }],
  reason: 'damaged' as const,
  idempotencyKey,
});

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe('baseline behaviour', () => {
  it('serves health without auth', async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });

  it('rejects a missing or wrong bearer token', async () => {
    expect((await fetch(`${server.url}/orders/9832`)).status).toBe(401);
    const wrong = await server.call('/orders/9832', { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  it('returns the seeded order 9832', async () => {
    const res = await server.call('/orders/9832');
    expect(res.status).toBe(200);
    const order = await json(res);
    expect(order.id).toBe('9832');
    expect(order.customerId).toBe('cus_014');
    expect(order.totalAmountMinor).toBe(349900);
    expect(order.currency).toBe('INR');
    expect(order.items).toEqual([
      {
        sku: 'SKU-CM-01',
        name: 'Coffee machine',
        category: 'appliance',
        quantity: 1,
        unitAmountMinor: 349900,
      },
    ]);
    const ageDays = (Date.now() - Date.parse(order.deliveredAt)) / 86_400_000;
    expect(ageDays).toBeGreaterThan(3.9);
    expect(ageDays).toBeLessThan(4.1);
  });

  it('404s on an unknown order', async () => {
    const res = await server.call('/orders/9999');
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('ORDER_NOT_FOUND');
  });

  it('400s when idempotencyKey is missing', async () => {
    const res = await server.call('/replacements', {
      method: 'POST',
      body: { orderId: '9832', items: [], reason: 'damaged' },
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('422s with zod issues on a malformed body', async () => {
    const res = await server.call('/replacements', {
      method: 'POST',
      body: { orderId: '9832', items: [], reason: 'exploded', idempotencyKey: 'bad-1' },
    });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe('INVALID_BODY');
    expect(Array.isArray(body.error.issues)).toBe(true);
  });

  it('409s when the order already has a replacement', async () => {
    const res = await server.call('/replacements', {
      method: 'POST',
      body: validBody('already-1', '9836'),
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({
      error: { code: 'ALREADY_REPLACED', existingId: 'REP-0001' },
    });
  });
});

describe('fault injection', () => {
  it('500 returns a JSON error body', async () => {
    const res = await server.call('/orders/9832', { headers: { 'x-acme-fault': '500' } });
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.error.code).toBe('INTERNAL');
    expect(typeof body.error.message).toBe('string');
  });

  it('slow responds only after the delay', async () => {
    const started = Date.now();
    const res = await server.call('/orders/9832', {
      headers: { 'x-acme-fault': 'slow', 'x-acme-fault-delay-ms': '250' },
    });
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    expect((await json(res)).id).toBe('9832');
  });

  it('malformed returns 200 with a body that fails the output schema', async () => {
    const res = await server.call('/orders/9832', { headers: { 'x-acme-fault': 'malformed' } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ id: 12345, orderId: null });
  });

  it('timeout holds the connection then closes it without a response', async () => {
    const started = Date.now();
    await expect(
      server.call('/orders/9832', {
        headers: { 'x-acme-fault': 'timeout', 'x-acme-fault-delay-ms': '200' },
      }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it('duplicate creates the entity twice and returns the second id', async () => {
    await resetOrder(server, '9832');
    const res = await server.call('/replacements', {
      method: 'POST',
      body: validBody('dup-1'),
      headers: { 'x-acme-fault': 'duplicate' },
    });
    expect(res.status).toBe(201);
    const created = await json(res);

    const list = await json(await server.call('/replacements?orderId=9832'));
    expect(list.replacements).toHaveLength(2);
    expect(list.replacements[1].id).toBe(created.id);
    expect(list.replacements[0].id).not.toBe(created.id);
  });

  it('stale accepts the write but reads keep showing the old state', async () => {
    await resetOrder(server, '9832');
    const res = await server.call('/replacements', {
      method: 'POST',
      body: validBody('stale-1'),
      headers: { 'x-acme-fault': 'stale' },
    });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created.orderId).toBe('9832');

    expect((await server.call(`/replacements/${created.id}`)).status).toBe(404);

    const list = await json(await server.call('/replacements?orderId=9832'));
    expect(list.replacements).toEqual([]);

    const order = await json(await server.call('/orders/9832'));
    expect(order.replacementIds).toEqual([]);
    expect(order.status).toBe('delivered');
  });
});

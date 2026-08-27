import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/db.js';
import { seed } from '../src/seed.js';
import { json, resetOrder, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe('server side idempotency', () => {
  it('collapses 20 parallel identical creates into one replacement', async () => {
    await resetOrder(server, '9832');
    const idempotencyKey = 'parallel-key-1';

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        server.call('/replacements', {
          method: 'POST',
          body: {
            orderId: '9832',
            items: [{ sku: 'SKU-CM-01', quantity: 1 }],
            reason: 'damaged',
            idempotencyKey,
          },
        }),
      ),
    );

    const bodies = await Promise.all(responses.map(json));
    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 201));
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);

    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from acme_replacements where order_id = '9832'`;
    expect(rows[0]?.count).toBe('1');

    const log = await json(await server.call('/admin/request-log?path=/replacements'));
    const reached = log.entries.filter(
      (e: { idempotencyKey: string | null; reachedBusinessLogic: boolean }) =>
        e.idempotencyKey === idempotencyKey && e.reachedBusinessLogic,
    );
    expect(reached).toHaveLength(1);
    const logged = log.entries.filter(
      (e: { idempotencyKey: string | null }) => e.idempotencyKey === idempotencyKey,
    );
    expect(logged).toHaveLength(20);
  });

  it('returns the stored response for a repeated key without re-running the write', async () => {
    await resetOrder(server, '9832');
    const body = {
      orderId: '9832',
      items: [{ sku: 'SKU-CM-01', quantity: 1 }],
      reason: 'damaged',
      idempotencyKey: 'sequential-key-1',
    };
    const first = await json(await server.call('/replacements', { method: 'POST', body }));
    const second = await json(await server.call('/replacements', { method: 'POST', body }));
    expect(second).toEqual(first);

    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from acme_replacements where order_id = '9832'`;
    expect(rows[0]?.count).toBe('1');
  });
});

describe('seed determinism', () => {
  async function dump() {
    const customers = await sql<{ id: string }[]>`select id from acme_customers order by id`;
    const orders = await sql<{ id: string; status: string; total_amount_minor: string }[]>`
      select id, status, total_amount_minor from acme_orders order by id`;
    const items = await sql<{ order_id: string; sku: string; unit_amount_minor: string }[]>`
      select order_id, sku, unit_amount_minor from acme_order_items order by order_id, sku`;
    const replacements = await sql<{ id: string; order_id: string }[]>`
      select id, order_id from acme_replacements order by id`;
    return {
      customers: [...customers],
      orders: [...orders],
      items: [...items],
      replacements: [...replacements],
    };
  }

  it('produces identical rows when run twice', async () => {
    await seed();
    const first = await dump();
    await seed();
    const second = await dump();

    expect(second).toEqual(first);
    expect(first.orders.map((o) => o.id)).toEqual([
      '9832',
      '9833',
      '9834',
      '9835',
      '9836',
      '9837',
      '9838',
      '9839',
      '9840',
      '9841',
    ]);
    expect(first.replacements).toEqual([{ id: 'REP-0001', order_id: '9836' }]);
    expect(first.customers).toEqual([{ id: 'cus_014' }]);
    expect(first.items).toHaveLength(10);
  });
});

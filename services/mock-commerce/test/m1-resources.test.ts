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

const refundBody = (idempotencyKey: string, orderId: string, amountMinor: number) => ({
  orderId,
  amountMinor,
  reason: 'damaged' as const,
  idempotencyKey,
});

const cancellationBody = (idempotencyKey: string, orderId: string) => ({
  orderId,
  reason: 'customer_request' as const,
  idempotencyKey,
});

const ticketBody = (idempotencyKey: string, orderId?: string) => ({
  customerId: 'cus_014',
  ...(orderId ? { orderId } : {}),
  subject: 'Item arrived damaged',
  body: 'The box was crushed on delivery.',
  priority: 'normal' as const,
  idempotencyKey,
});

async function countRows(table: 'refunds' | 'cancellations' | 'tickets', orderId: string) {
  const rows =
    table === 'refunds'
      ? await sql<{ count: string }[]>`
          select count(*)::text as count from acme_refunds where order_id = ${orderId}`
      : table === 'cancellations'
        ? await sql<{ count: string }[]>`
            select count(*)::text as count from acme_cancellations where order_id = ${orderId}`
        : await sql<{ count: string }[]>`
            select count(*)::text as count from acme_tickets where order_id = ${orderId}`;
  return rows[0]?.count;
}

describe('refunds', () => {
  it('creates a partial refund and reads it back', async () => {
    await resetOrder(server, '9840');
    const res = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-create-1', '9840', 100000),
    });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created).toEqual({
      id: expect.stringMatching(/^REF-\d{4}$/),
      orderId: '9840',
      amountMinor: 100000,
      currency: 'INR',
      reason: 'damaged',
      status: 'created',
      createdAt: expect.any(String),
    });

    const fetched = await json(await server.call(`/refunds/${created.id}`));
    expect(fetched).toEqual(created);

    const list = await json(await server.call('/refunds?orderId=9840'));
    expect(list.refunds).toEqual([created]);

    const order = await json(await server.call('/orders/9840'));
    expect(order.status).toBe('delivered');
  });

  it('404s on an unknown order', async () => {
    const res = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-unknown-1', '9999', 1000),
    });
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('ORDER_NOT_FOUND');
  });

  it('422s on a non-positive amount', async () => {
    const res = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-zero-1', '9840', 0),
    });
    expect(res.status).toBe(422);
    expect((await json(res)).error.code).toBe('INVALID_BODY');
  });

  it('422s when the refund would exceed the order total', async () => {
    await resetOrder(server, '9840');
    const first = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-exceed-setup', '9840', 500000),
    });
    expect(first.status).toBe(201);

    const res = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-exceed-1', '9840', 100000),
    });
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({
      error: {
        code: 'REFUND_EXCEEDS_ORDER_TOTAL',
        orderTotalMinor: 549900,
        alreadyRefundedMinor: 500000,
      },
    });
  });

  it('accumulates partial refunds and flips the order to refunded at the total', async () => {
    await resetOrder(server, '9840');
    const first = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-part-1', '9840', 300000),
    });
    expect(first.status).toBe(201);
    expect((await json(await server.call('/orders/9840'))).status).toBe('delivered');

    const second = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-part-2', '9840', 249900),
    });
    expect(second.status).toBe(201);

    const order = await json(await server.call('/orders/9840'));
    expect(order.status).toBe('refunded');

    const list = await json(await server.call('/refunds?orderId=9840'));
    expect(list.refunds.map((r: { amountMinor: number }) => r.amountMinor)).toEqual([
      300000, 249900,
    ]);
  });

  it('409s when the order is already fully refunded', async () => {
    const res = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('refund-already-1', '9841', 1000),
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({
      error: { code: 'ALREADY_REFUNDED', existingId: 'REF-0001' },
    });
  });

  it('400s when idempotencyKey is missing', async () => {
    const res = await server.call('/refunds', {
      method: 'POST',
      body: { orderId: '9840', amountMinor: 1000, reason: 'damaged' },
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });
});

describe('cancellations', () => {
  it('cancels a confirmed order and refuses the second attempt', async () => {
    await resetOrder(server, '9838');
    const res = await server.call('/cancellations', {
      method: 'POST',
      body: cancellationBody('cancel-1', '9838'),
    });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created).toEqual({
      id: expect.stringMatching(/^CAN-\d{4}$/),
      orderId: '9838',
      reason: 'customer_request',
      status: 'created',
      createdAt: expect.any(String),
    });

    expect(await json(await server.call(`/cancellations/${created.id}`))).toEqual(created);
    const list = await json(await server.call('/cancellations?orderId=9838'));
    expect(list.cancellations).toEqual([created]);
    expect((await json(await server.call('/orders/9838'))).status).toBe('cancelled');

    const again = await server.call('/cancellations', {
      method: 'POST',
      body: cancellationBody('cancel-2', '9838'),
    });
    expect(again.status).toBe(409);
    expect(await json(again)).toEqual({
      error: { code: 'ALREADY_CANCELLED', existingId: created.id },
    });
  });

  it('409s on an order that has already shipped', async () => {
    const res = await server.call('/cancellations', {
      method: 'POST',
      body: cancellationBody('cancel-shipped-1', '9839'),
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({
      error: { code: 'ORDER_NOT_CANCELLABLE', status: 'shipped' },
    });
  });

  it('404s on an unknown order', async () => {
    const res = await server.call('/cancellations', {
      method: 'POST',
      body: cancellationBody('cancel-unknown-1', '9999'),
    });
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('tickets', () => {
  it('creates a ticket and lists it by order and by customer', async () => {
    await resetOrder(server, '9840');
    const res = await server.call('/tickets', {
      method: 'POST',
      body: ticketBody('ticket-1', '9840'),
    });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created).toEqual({
      id: expect.stringMatching(/^TIC-\d{4}$/),
      customerId: 'cus_014',
      orderId: '9840',
      subject: 'Item arrived damaged',
      priority: 'normal',
      status: 'open',
      createdAt: expect.any(String),
    });
    expect(created.body).toBeUndefined();

    expect(await json(await server.call(`/tickets/${created.id}`))).toEqual(created);
    const byOrder = await json(await server.call('/tickets?orderId=9840'));
    expect(byOrder.tickets).toEqual([created]);
    const byCustomer = await json(await server.call('/tickets?customerId=cus_014'));
    expect(byCustomer.tickets.map((t: { id: string }) => t.id)).toContain(created.id);
  });

  it('creates a ticket without an order', async () => {
    const res = await server.call('/tickets', {
      method: 'POST',
      body: ticketBody('ticket-no-order-1'),
    });
    expect(res.status).toBe(201);
    expect((await json(res)).orderId).toBeNull();
  });

  it('404s on an unknown customer or unknown order', async () => {
    const unknownCustomer = await server.call('/tickets', {
      method: 'POST',
      body: { ...ticketBody('ticket-bad-cus-1'), customerId: 'cus_999' },
    });
    expect(unknownCustomer.status).toBe(404);
    expect((await json(unknownCustomer)).error.code).toBe('CUSTOMER_NOT_FOUND');

    const unknownOrder = await server.call('/tickets', {
      method: 'POST',
      body: ticketBody('ticket-bad-order-1', '9999'),
    });
    expect(unknownOrder.status).toBe(404);
    expect((await json(unknownOrder)).error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('server side idempotency on the new resources', () => {
  it('collapses 20 parallel identical refund creates into one row', async () => {
    await resetOrder(server, '9840');
    const body = refundBody('parallel-refund-1', '9840', 100000);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => server.call('/refunds', { method: 'POST', body })),
    );
    const bodies = await Promise.all(responses.map(json));
    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 201));
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
    expect(await countRows('refunds', '9840')).toBe('1');
  });

  it('collapses 20 parallel identical cancellation creates into one row', async () => {
    await resetOrder(server, '9837');
    const body = cancellationBody('parallel-cancel-1', '9837');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => server.call('/cancellations', { method: 'POST', body })),
    );
    const bodies = await Promise.all(responses.map(json));
    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 201));
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
    expect(await countRows('cancellations', '9837')).toBe('1');
  });

  it('collapses 20 parallel identical ticket creates into one row', async () => {
    await resetOrder(server, '9840');
    const body = ticketBody('parallel-ticket-1', '9840');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => server.call('/tickets', { method: 'POST', body })),
    );
    const bodies = await Promise.all(responses.map(json));
    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 201));
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
    expect(await countRows('tickets', '9840')).toBe('1');
  });
});

describe('faults on the new resources', () => {
  it('stale hides the refund and leaves the order untouched', async () => {
    await resetOrder(server, '9840');
    const res = await server.call('/refunds', {
      method: 'POST',
      body: refundBody('stale-refund-1', '9840', 549900),
      headers: { 'x-acme-fault': 'stale' },
    });
    expect(res.status).toBe(201);
    const created = await json(res);

    expect((await server.call(`/refunds/${created.id}`)).status).toBe(404);
    expect((await json(await server.call('/refunds?orderId=9840'))).refunds).toEqual([]);
    expect((await json(await server.call('/orders/9840'))).status).toBe('delivered');
  });

  it('stale hides the cancellation and leaves the order untouched', async () => {
    await resetOrder(server, '9837');
    const res = await server.call('/cancellations', {
      method: 'POST',
      body: cancellationBody('stale-cancel-1', '9837'),
      headers: { 'x-acme-fault': 'stale' },
    });
    expect(res.status).toBe(201);
    const created = await json(res);

    expect((await server.call(`/cancellations/${created.id}`)).status).toBe(404);
    expect((await json(await server.call('/cancellations?orderId=9837'))).cancellations).toEqual(
      [],
    );
    expect((await json(await server.call('/orders/9837'))).status).toBe('placed');
  });

  it('stale hides the ticket', async () => {
    await resetOrder(server, '9840');
    const res = await server.call('/tickets', {
      method: 'POST',
      body: ticketBody('stale-ticket-1', '9840'),
      headers: { 'x-acme-fault': 'stale' },
    });
    expect(res.status).toBe(201);
    const created = await json(res);

    expect((await server.call(`/tickets/${created.id}`)).status).toBe(404);
    expect((await json(await server.call('/tickets?orderId=9840'))).tickets).toEqual([]);
  });

  it('duplicate writes each resource twice and returns the second id', async () => {
    await resetOrder(server, '9840');
    const refund = await json(
      await server.call('/refunds', {
        method: 'POST',
        body: refundBody('dup-refund-1', '9840', 100000),
        headers: { 'x-acme-fault': 'duplicate' },
      }),
    );
    const refunds = (await json(await server.call('/refunds?orderId=9840'))).refunds;
    expect(refunds).toHaveLength(2);
    expect(refunds[1].id).toBe(refund.id);

    await resetOrder(server, '9837');
    const cancellation = await json(
      await server.call('/cancellations', {
        method: 'POST',
        body: cancellationBody('dup-cancel-1', '9837'),
        headers: { 'x-acme-fault': 'duplicate' },
      }),
    );
    const cancellations = (await json(await server.call('/cancellations?orderId=9837')))
      .cancellations;
    expect(cancellations).toHaveLength(2);
    expect(cancellations[1].id).toBe(cancellation.id);

    await resetOrder(server, '9838');
    const ticket = await json(
      await server.call('/tickets', {
        method: 'POST',
        body: ticketBody('dup-ticket-1', '9838'),
        headers: { 'x-acme-fault': 'duplicate' },
      }),
    );
    const tickets = (await json(await server.call('/tickets?orderId=9838'))).tickets;
    expect(tickets).toHaveLength(2);
    expect(tickets[1].id).toBe(ticket.id);
  });
});

describe('seed determinism with the new resources', () => {
  async function dump() {
    const orders = await sql<{ id: string; status: string; total_amount_minor: string }[]>`
      select id, status, total_amount_minor from acme_orders order by id`;
    const refunds = await sql<{ id: string; order_id: string; amount_minor: string }[]>`
      select id, order_id, amount_minor from acme_refunds order by id`;
    const cancellations = await sql<
      { id: string }[]
    >`select id from acme_cancellations order by id`;
    const tickets = await sql<{ id: string }[]>`select id from acme_tickets order by id`;
    return {
      orders: [...orders],
      refunds: [...refunds],
      cancellations: [...cancellations],
      tickets: [...tickets],
    };
  }

  it('produces identical rows when run twice', async () => {
    await seed();
    const first = await dump();
    await seed();
    const second = await dump();

    expect(second).toEqual(first);
    expect(first.refunds).toEqual([{ id: 'REF-0001', order_id: '9841', amount_minor: '899900' }]);
    expect(first.cancellations).toEqual([]);
    expect(first.tickets).toEqual([]);
    expect(
      first.orders.filter((o) => o.id >= '9837').map((o) => [o.id, o.status, o.total_amount_minor]),
    ).toEqual([
      ['9837', 'placed', '249900'],
      ['9838', 'confirmed', '1299900'],
      ['9839', 'shipped', '179900'],
      ['9840', 'delivered', '549900'],
      ['9841', 'refunded', '899900'],
    ]);
  });
});

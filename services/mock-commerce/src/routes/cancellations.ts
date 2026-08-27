import { now } from '@kora/core';
import { Hono } from 'hono';
import { one, sql } from '../db.js';
import type { AppEnv, Fault } from '../faults.js';
import { idempotentCreate, type StoredResponse } from '../idempotency.js';
import {
  type CancellationReason,
  type CancellationResponse,
  type CreateCancellationBody,
  createCancellationBody,
  type OrderStatus,
} from '../schema.js';
import { findOrderRow } from './orders.js';

interface CancellationRow {
  id: string;
  order_id: string;
  reason: CancellationReason;
  status: CancellationResponse['status'];
  created_at: Date;
}

const cancellableStatuses: OrderStatus[] = ['placed', 'confirmed'];

function toResponse(row: CancellationRow): CancellationResponse {
  return {
    id: row.id,
    orderId: row.order_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

async function nextCancellationId(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select 'CAN-' || lpad(nextval('acme_cancellation_seq')::text, 4, '0') as id`;
  return one(rows).id;
}

async function insertCancellation(
  body: CreateCancellationBody,
  idempotencyKey: string,
  hidden: boolean,
): Promise<CancellationRow> {
  const rows = await sql<CancellationRow[]>`
    insert into acme_cancellations
      (id, order_id, reason, status, created_at, idempotency_key, hidden)
    values (
      ${await nextCancellationId()},
      ${body.orderId},
      ${body.reason},
      'created',
      ${now()},
      ${idempotencyKey},
      ${hidden}
    )
    returning *`;
  return one(rows);
}

async function createCancellation(
  body: CreateCancellationBody,
  fault: Fault | null,
): Promise<StoredResponse> {
  const order = await findOrderRow(body.orderId);
  if (!order) return { status: 404, body: { error: { code: 'ORDER_NOT_FOUND' } } };

  const existing = await sql<{ id: string }[]>`
    select id from acme_cancellations
    where order_id = ${body.orderId} and hidden = false limit 1`;
  if (existing[0]) {
    return {
      status: 409,
      body: { error: { code: 'ALREADY_CANCELLED', existingId: existing[0].id } },
    };
  }

  if (!cancellableStatuses.includes(order.status)) {
    return {
      status: 409,
      body: { error: { code: 'ORDER_NOT_CANCELLABLE', status: order.status } },
    };
  }

  const hidden = fault === 'stale';
  const first = await insertCancellation(body, body.idempotencyKey, hidden);
  const created =
    fault === 'duplicate'
      ? await insertCancellation(body, `${body.idempotencyKey}:duplicate`, hidden)
      : first;

  if (!hidden) {
    await sql`update acme_orders set status = 'cancelled' where id = ${body.orderId}`;
  }
  return { status: 201, body: toResponse(created) };
}

export const cancellationsRoutes = new Hono<AppEnv>();

cancellationsRoutes.post('/', (c) =>
  idempotentCreate(c, createCancellationBody, createCancellation),
);

cancellationsRoutes.get('/', async (c) => {
  const orderId = c.req.query('orderId');
  if (!orderId) return c.json({ error: { code: 'MISSING_ORDER_ID' } }, 422);
  const rows = await sql<CancellationRow[]>`
    select * from acme_cancellations
    where order_id = ${orderId} and hidden = false order by id`;
  return c.json({ cancellations: rows.map(toResponse) });
});

cancellationsRoutes.get('/:id', async (c) => {
  const rows = await sql<CancellationRow[]>`
    select * from acme_cancellations where id = ${c.req.param('id')} and hidden = false`;
  const row = rows[0];
  if (!row) return c.json({ error: { code: 'CANCELLATION_NOT_FOUND' } }, 404);
  return c.json(toResponse(row));
});

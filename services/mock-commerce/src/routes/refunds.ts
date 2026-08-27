import { now } from '@kora/core';
import { Hono } from 'hono';
import { one, sql } from '../db.js';
import type { AppEnv, Fault } from '../faults.js';
import { idempotentCreate, type StoredResponse } from '../idempotency.js';
import {
  type CreateRefundBody,
  createRefundBody,
  type RefundReason,
  type RefundResponse,
} from '../schema.js';
import { findOrderRow } from './orders.js';

interface RefundRow {
  id: string;
  order_id: string;
  amount_minor: string;
  reason: RefundReason;
  status: RefundResponse['status'];
  created_at: Date;
  currency: string;
}

function toResponse(row: RefundRow): RefundResponse {
  return {
    id: row.id,
    orderId: row.order_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

async function nextRefundId(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select 'REF-' || lpad(nextval('acme_refund_seq')::text, 4, '0') as id`;
  return one(rows).id;
}

async function insertRefund(
  body: CreateRefundBody,
  currency: string,
  idempotencyKey: string,
  hidden: boolean,
): Promise<RefundRow> {
  const rows = await sql<Omit<RefundRow, 'currency'>[]>`
    insert into acme_refunds
      (id, order_id, amount_minor, reason, status, created_at, idempotency_key, hidden)
    values (
      ${await nextRefundId()},
      ${body.orderId},
      ${body.amountMinor},
      ${body.reason},
      'created',
      ${now()},
      ${idempotencyKey},
      ${hidden}
    )
    returning *`;
  return { ...one(rows), currency };
}

async function refundedTotalMinor(orderId: string): Promise<number> {
  const rows = await sql<{ total: string }[]>`
    select coalesce(sum(amount_minor), 0)::text as total
    from acme_refunds where order_id = ${orderId} and hidden = false`;
  return Number(one(rows).total);
}

async function createRefund(body: CreateRefundBody, fault: Fault | null): Promise<StoredResponse> {
  const order = await findOrderRow(body.orderId);
  if (!order) return { status: 404, body: { error: { code: 'ORDER_NOT_FOUND' } } };

  const orderTotalMinor = Number(order.total_amount_minor);
  const alreadyRefundedMinor = await refundedTotalMinor(body.orderId);

  if (alreadyRefundedMinor >= orderTotalMinor) {
    const existing = await sql<{ id: string }[]>`
      select id from acme_refunds
      where order_id = ${body.orderId} and hidden = false order by id limit 1`;
    return {
      status: 409,
      body: { error: { code: 'ALREADY_REFUNDED', existingId: existing[0]?.id ?? null } },
    };
  }

  if (alreadyRefundedMinor + body.amountMinor > orderTotalMinor) {
    return {
      status: 422,
      body: {
        error: {
          code: 'REFUND_EXCEEDS_ORDER_TOTAL',
          orderTotalMinor,
          alreadyRefundedMinor,
        },
      },
    };
  }

  const hidden = fault === 'stale';
  const first = await insertRefund(body, order.currency, body.idempotencyKey, hidden);
  const created =
    fault === 'duplicate'
      ? await insertRefund(body, order.currency, `${body.idempotencyKey}:duplicate`, hidden)
      : first;

  if (!hidden && (await refundedTotalMinor(body.orderId)) >= orderTotalMinor) {
    await sql`update acme_orders set status = 'refunded' where id = ${body.orderId}`;
  }
  return { status: 201, body: toResponse(created) };
}

export const refundsRoutes = new Hono<AppEnv>();

refundsRoutes.post('/', (c) => idempotentCreate(c, createRefundBody, createRefund));

refundsRoutes.get('/', async (c) => {
  const orderId = c.req.query('orderId');
  if (!orderId) return c.json({ error: { code: 'MISSING_ORDER_ID' } }, 422);
  const rows = await sql<RefundRow[]>`
    select r.*, o.currency from acme_refunds r
    join acme_orders o on o.id = r.order_id
    where r.order_id = ${orderId} and r.hidden = false order by r.id`;
  return c.json({ refunds: rows.map(toResponse) });
});

refundsRoutes.get('/:id', async (c) => {
  const rows = await sql<RefundRow[]>`
    select r.*, o.currency from acme_refunds r
    join acme_orders o on o.id = r.order_id
    where r.id = ${c.req.param('id')} and r.hidden = false`;
  const row = rows[0];
  if (!row) return c.json({ error: { code: 'REFUND_NOT_FOUND' } }, 404);
  return c.json(toResponse(row));
});

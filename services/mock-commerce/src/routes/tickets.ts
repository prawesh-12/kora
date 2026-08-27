import { now } from '@kora/core';
import { Hono } from 'hono';
import { one, sql } from '../db.js';
import type { AppEnv, Fault } from '../faults.js';
import { idempotentCreate, type StoredResponse } from '../idempotency.js';
import {
  type CreateTicketBody,
  createTicketBody,
  type TicketPriority,
  type TicketResponse,
} from '../schema.js';
import { findOrderRow } from './orders.js';

interface TicketRow {
  id: string;
  order_id: string | null;
  customer_id: string;
  subject: string;
  priority: TicketPriority;
  status: TicketResponse['status'];
  created_at: Date;
}

function toResponse(row: TicketRow): TicketResponse {
  return {
    id: row.id,
    customerId: row.customer_id,
    orderId: row.order_id,
    subject: row.subject,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

async function nextTicketId(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select 'TIC-' || lpad(nextval('acme_ticket_seq')::text, 4, '0') as id`;
  return one(rows).id;
}

async function insertTicket(
  body: CreateTicketBody,
  idempotencyKey: string,
  hidden: boolean,
): Promise<TicketRow> {
  const rows = await sql<TicketRow[]>`
    insert into acme_tickets
      (id, order_id, customer_id, subject, body, priority, status, created_at,
       idempotency_key, hidden)
    values (
      ${await nextTicketId()},
      ${body.orderId ?? null},
      ${body.customerId},
      ${body.subject},
      ${body.body},
      ${body.priority},
      'open',
      ${now()},
      ${idempotencyKey},
      ${hidden}
    )
    returning *`;
  return one(rows);
}

async function createTicket(body: CreateTicketBody, fault: Fault | null): Promise<StoredResponse> {
  const customer = await sql<{ id: string }[]>`
    select id from acme_customers where id = ${body.customerId}`;
  if (!customer[0]) return { status: 404, body: { error: { code: 'CUSTOMER_NOT_FOUND' } } };

  if (body.orderId && !(await findOrderRow(body.orderId))) {
    return { status: 404, body: { error: { code: 'ORDER_NOT_FOUND' } } };
  }

  const hidden = fault === 'stale';
  const first = await insertTicket(body, body.idempotencyKey, hidden);
  const created =
    fault === 'duplicate'
      ? await insertTicket(body, `${body.idempotencyKey}:duplicate`, hidden)
      : first;

  return { status: 201, body: toResponse(created) };
}

export const ticketsRoutes = new Hono<AppEnv>();

ticketsRoutes.post('/', (c) => idempotentCreate(c, createTicketBody, createTicket));

ticketsRoutes.get('/', async (c) => {
  const orderId = c.req.query('orderId');
  const customerId = c.req.query('customerId');
  if (!orderId && !customerId) {
    return c.json({ error: { code: 'MISSING_FILTER' } }, 422);
  }
  const rows = orderId
    ? await sql<TicketRow[]>`
        select * from acme_tickets
        where order_id = ${orderId} and hidden = false order by id`
    : await sql<TicketRow[]>`
        select * from acme_tickets
        where customer_id = ${customerId ?? ''} and hidden = false order by id`;
  return c.json({ tickets: rows.map(toResponse) });
});

ticketsRoutes.get('/:id', async (c) => {
  const rows = await sql<TicketRow[]>`
    select * from acme_tickets where id = ${c.req.param('id')} and hidden = false`;
  const row = rows[0];
  if (!row) return c.json({ error: { code: 'TICKET_NOT_FOUND' } }, 404);
  return c.json(toResponse(row));
});

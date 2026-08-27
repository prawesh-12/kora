import { createHash } from 'node:crypto';
import { canonicalJson, now } from '@kora/core';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { JSONValue } from 'postgres';
import { one, sql } from '../db.js';
import { type AppEnv, delay, type Fault } from '../faults.js';
import { type CreateReplacementBody, createReplacementBody } from '../schema.js';
import type { CreateReplacementResponse } from '../schema.js';
import { ESTIMATED_DELIVERY_DAYS } from '../seed.js';
import { findOrderRow } from './orders.js';

interface ReplacementRow {
  id: string;
  order_id: string;
  reason: string;
  status: 'created' | 'processing';
  created_at: Date;
  estimated_delivery_days: number;
}

interface StoredResponse {
  status: number;
  body: unknown;
}

const IDEMPOTENCY_WAIT_ATTEMPTS = 200;
const IDEMPOTENCY_WAIT_INTERVAL_MS = 25;

function toResponse(row: ReplacementRow): CreateReplacementResponse {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    estimatedDeliveryDays: row.estimated_delivery_days,
  };
}

async function nextReplacementId(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select 'REP-' || lpad(nextval('acme_replacement_seq')::text, 4, '0') as id`;
  return one(rows).id;
}

async function insertReplacement(
  body: CreateReplacementBody,
  idempotencyKey: string,
  hidden: boolean,
): Promise<ReplacementRow> {
  const rows = await sql<ReplacementRow[]>`
    insert into acme_replacements
      (id, order_id, reason, status, created_at, estimated_delivery_days, idempotency_key, hidden)
    values (
      ${await nextReplacementId()},
      ${body.orderId},
      ${body.reason},
      'created',
      ${now()},
      ${ESTIMATED_DELIVERY_DAYS},
      ${idempotencyKey},
      ${hidden}
    )
    returning *`;
  return one(rows);
}

async function createReplacement(
  body: CreateReplacementBody,
  fault: Fault | null,
): Promise<StoredResponse> {
  const order = await findOrderRow(body.orderId);
  if (!order) return { status: 404, body: { error: { code: 'ORDER_NOT_FOUND' } } };

  const existing = await sql<{ id: string }[]>`
    select id from acme_replacements
    where order_id = ${body.orderId} and hidden = false limit 1`;
  if (existing[0]) {
    return {
      status: 409,
      body: { error: { code: 'ALREADY_REPLACED', existingId: existing[0].id } },
    };
  }

  const hidden = fault === 'stale';
  const first = await insertReplacement(body, body.idempotencyKey, hidden);
  const created =
    fault === 'duplicate'
      ? await insertReplacement(body, `${body.idempotencyKey}:duplicate`, hidden)
      : first;

  if (!hidden) {
    await sql`update acme_orders set status = 'replacement_created' where id = ${body.orderId}`;
  }
  return { status: 201, body: toResponse(created) };
}

async function waitForStoredResponse(key: string): Promise<StoredResponse | null> {
  for (let attempt = 0; attempt < IDEMPOTENCY_WAIT_ATTEMPTS; attempt++) {
    const rows = await sql<{ response: StoredResponse | null }[]>`
      select response from acme_idempotency where key = ${key}`;
    const stored = rows[0]?.response;
    if (stored) return stored;
    await delay(IDEMPOTENCY_WAIT_INTERVAL_MS);
  }
  return null;
}

export const replacementsRoutes = new Hono<AppEnv>();

replacementsRoutes.post('/', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: { code: 'INVALID_JSON' } }, 422);
  }

  const key = (raw as { idempotencyKey?: unknown } | null)?.idempotencyKey;
  if (typeof key !== 'string' || key.length === 0) {
    return c.json({ error: { code: 'MISSING_IDEMPOTENCY_KEY' } }, 400);
  }
  c.set('idempotencyKey', key);

  const parsed = createReplacementBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { code: 'INVALID_BODY', issues: parsed.error.issues } }, 422);
  }
  const body = parsed.data;
  const hash = createHash('sha256').update(canonicalJson(body)).digest('hex');

  const claimed = await sql<{ key: string }[]>`
    insert into acme_idempotency (key, request_hash) values (${key}, ${hash})
    on conflict (key) do nothing
    returning key`;

  if (!claimed[0]) {
    const stored = await waitForStoredResponse(key);
    if (!stored) return c.json({ error: { code: 'IDEMPOTENCY_PENDING' } }, 409);
    return c.json(stored.body, stored.status as ContentfulStatusCode);
  }

  c.set('reachedBusinessLogic', true);
  const result = await createReplacement(body, c.get('fault'));
  await sql`
    update acme_idempotency
    set response = ${sql.json(result as unknown as JSONValue)}
    where key = ${key}`;
  return c.json(result.body, result.status as ContentfulStatusCode);
});

replacementsRoutes.get('/', async (c) => {
  const orderId = c.req.query('orderId');
  if (!orderId) return c.json({ error: { code: 'MISSING_ORDER_ID' } }, 422);
  const rows = await sql<ReplacementRow[]>`
    select * from acme_replacements
    where order_id = ${orderId} and hidden = false order by id`;
  return c.json({ replacements: rows.map(toResponse) });
});

replacementsRoutes.get('/:id', async (c) => {
  const rows = await sql<ReplacementRow[]>`
    select * from acme_replacements where id = ${c.req.param('id')} and hidden = false`;
  const row = rows[0];
  if (!row) return c.json({ error: { code: 'REPLACEMENT_NOT_FOUND' } }, 404);
  return c.json(toResponse(row));
});

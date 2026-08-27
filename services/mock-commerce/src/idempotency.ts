import { createHash } from 'node:crypto';
import { canonicalJson } from '@kora/core';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { JSONValue } from 'postgres';
import type { z } from 'zod';
import { sql } from './db.js';
import { type AppEnv, delay, type Fault } from './faults.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

export type CreateHandler<T> = (body: T, fault: Fault | null) => Promise<StoredResponse>;

const WAIT_ATTEMPTS = 200;
const WAIT_INTERVAL_MS = 25;

async function waitForStoredResponse(key: string): Promise<StoredResponse | null> {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
    const rows = await sql<{ response: StoredResponse | null }[]>`
      select response from acme_idempotency where key = ${key}`;
    const stored = rows[0]?.response;
    if (stored) return stored;
    await delay(WAIT_INTERVAL_MS);
  }
  return null;
}

export async function idempotentCreate<T>(
  c: Context<AppEnv>,
  schema: z.ZodType<T>,
  create: CreateHandler<T>,
): Promise<Response> {
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

  const parsed = schema.safeParse(raw);
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
  const result = await create(body, c.get('fault'));
  await sql`
    update acme_idempotency
    set response = ${sql.json(result as unknown as JSONValue)}
    where key = ${key}`;
  return c.json(result.body, result.status as ContentfulStatusCode);
}

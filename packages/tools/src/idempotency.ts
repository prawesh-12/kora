import { createHash } from 'node:crypto';
import { canonicalJson } from '@kora/core';
import { type Tx, db, eq, idempotencyKeys, sql } from '@kora/db';

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 5000;
const TTL_HOURS = 24;

export function deriveKey(args: {
  tenantId: string;
  conversationId: string;
  toolName: string;
  toolVersion: number;
  input: unknown;
}): string {
  // The input hash is part of the key on purpose. A retry with different
  // arguments is a different action and must not deduplicate against the first.
  //
  // The key is scoped to the conversation rather than the run. Resuming after a
  // human approval starts a new run, and so does a customer submitting twice;
  // both must land on the same key or the second one writes again.
  const material = [
    args.tenantId,
    args.conversationId,
    args.toolName,
    String(args.toolVersion),
    canonicalJson(args.input),
  ].join('|');
  return `idm_${createHash('sha256').update(material).digest('hex').slice(0, 40)}`;
}

export function requestHash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

export type Claim =
  | { kind: 'owned'; key: string; attempt: number }
  | { kind: 'replayed'; key: string; response: unknown }
  | { kind: 'failed'; key: string; errorCode: string }
  | { kind: 'busy'; key: string };

interface KeyRow {
  key: string;
  status: 'in_progress' | 'succeeded' | 'failed';
  response: unknown;
  error_code: string | null;
  attempt: number;
}

async function tryInsert(args: {
  key: string;
  tenantId: string;
  scope: string;
  requestHash: string;
}): Promise<boolean> {
  const rows = await sql()<{ key: string }[]>`
    INSERT INTO idempotency_keys (key, tenant_id, scope, request_hash, status, attempt, created_at, expires_at)
    VALUES (${args.key}, ${args.tenantId}, ${args.scope}, ${args.requestHash}, 'in_progress', 1,
            now(), now() + ${`${TTL_HOURS} hours`}::interval)
    ON CONFLICT (key) DO NOTHING
    RETURNING key`;
  return rows.length > 0;
}

async function read(key: string): Promise<KeyRow | null> {
  const rows = await sql()<KeyRow[]>`
    SELECT key, status, response, error_code, attempt FROM idempotency_keys WHERE key = ${key}`;
  return rows[0] ?? null;
}

/**
 * Re-claims a row that previously failed, but only if it is still `failed` and
 * still on the same attempt we read. The WHERE clause is the compare-and-swap.
 */
async function reclaimFailed(key: string, attempt: number): Promise<number | null> {
  const rows = await sql()<{ attempt: number }[]>`
    UPDATE idempotency_keys
    SET status = 'in_progress', attempt = attempt + 1
    WHERE key = ${key} AND status = 'failed' AND attempt = ${attempt}
    RETURNING attempt`;
  return rows[0]?.attempt ?? null;
}

export async function claim(args: {
  key: string;
  tenantId: string;
  scope: string;
  requestHash: string;
  maxRetries: number;
}): Promise<Claim> {
  if (await tryInsert(args)) return { kind: 'owned', key: args.key, attempt: 1 };

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    const row = await read(args.key);
    if (!row) {
      // The owner's row expired and was cleaned up between our insert and our read.
      if (await tryInsert(args)) return { kind: 'owned', key: args.key, attempt: 1 };
      continue;
    }

    if (row.status === 'succeeded') {
      return { kind: 'replayed', key: args.key, response: row.response };
    }

    if (row.status === 'failed') {
      if (row.attempt > args.maxRetries) {
        return { kind: 'failed', key: args.key, errorCode: row.error_code ?? 'UPSTREAM_5XX' };
      }
      const attempt = await reclaimFailed(args.key, row.attempt);
      if (attempt !== null) return { kind: 'owned', key: args.key, attempt };
      continue;
    }

    // in_progress. Never execute concurrently: an orphaned claim is safer than a
    // duplicate write.
    if (Date.now() >= deadline) return { kind: 'busy', key: args.key };
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * Settling runs through drizzle so it can share a transaction with the
 * `tool_executions` insert. A postgres.js transaction would not cover a drizzle
 * write: they take different connections from the pool.
 */
export async function settleSuccess(key: string, response: unknown, tx?: Tx): Promise<void> {
  await (tx ?? db())
    .update(idempotencyKeys)
    .set({ status: 'succeeded', response })
    .where(eq(idempotencyKeys.key, key));
}

export async function settleFailure(key: string, errorCode: string, tx?: Tx): Promise<void> {
  await (tx ?? db())
    .update(idempotencyKeys)
    .set({ status: 'failed', errorCode })
    .where(eq(idempotencyKeys.key, key));
}

export async function cleanupExpired(): Promise<number> {
  const rows = await sql()<{ key: string }[]>`
    DELETE FROM idempotency_keys WHERE expires_at < now() RETURNING key`;
  return rows.length;
}

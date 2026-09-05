import { sql } from '@kora/db';
import { STRIPE_WRITE_TOOLS } from '@kora/tools';

export async function knowledgeIsPopulated(tenantId: string): Promise<boolean> {
  const rows = await sql()<{ n: string }[]>`
    SELECT count(*) AS n FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.tenant_id = ${tenantId} AND d.status = 'active' AND c.embedding IS NOT NULL`;
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function setKnowledgeStatus(tenantId: string, status: string): Promise<void> {
  await sql()`UPDATE documents SET status = ${status} WHERE tenant_id = ${tenantId}`;
}

/**
 * Deletes every claim for the tenant. Only safe between passes, never during one:
 * scenarios run concurrently, and deleting a claim another scenario is holding is
 * how a benchmark manufactures the duplicate write it is meant to detect.
 *
 * A scenario does not need this. Each one opens a new conversation and the
 * idempotency key is scoped to the conversation, so nothing can collide.
 */
export async function clearIdempotency(tenantId: string): Promise<void> {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${tenantId}`;
}

/**
 * Money writes that actually executed. Read from the execution rows rather than
 * from what a scenario expected: the whole point of the shadow assertion is that
 * Kora's own view of what it did might be wrong.
 */
export async function moneyWrites(tenantId: string, since: Date): Promise<number> {
  const rows = await sql()<{ n: string }[]>`
    SELECT count(*) AS n FROM tool_executions
    WHERE tenant_id = ${tenantId}
      AND tool_name = ANY(${STRIPE_WRITE_TOOLS})
      AND status = 'ok'
      AND started_at >= ${since.toISOString()}::timestamptz`;
  return Number(rows[0]?.n ?? 0);
}

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
 * Only safe between passes: deleting a claim another scenario is holding manufactures
 * the duplicate write the benchmark exists to detect. An individual scenario never
 * needs it, since the key is scoped to its own new conversation.
 */
export async function clearIdempotency(tenantId: string): Promise<void> {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${tenantId}`;
}

/**
 * Read from the execution rows rather than from what a scenario expected: the shadow
 * assertion exists because Kora's own view of what it did might be wrong.
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

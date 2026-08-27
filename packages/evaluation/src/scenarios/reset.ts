import { sql } from '@kora/db';
import { acmeAdmin, acmeReader } from '@kora/tools';

const ALL_ORDERS = ['9832', '9833', '9834', '9835', '9836'];

export function acmeIsUp(): Promise<boolean> {
  return acmeAdmin.health();
}

/**
 * Resets only the entities a scenario touches, so one scenario's reset does not
 * wipe another's fixture.
 */
export function resetAcmeOrders(orderIds: string[] = ALL_ORDERS): Promise<void> {
  return acmeAdmin.reset(orderIds);
}

export function replacementsForOrder(orderId: string) {
  return acmeReader.listReplacements(orderId);
}

export function orderStatus(orderId: string): Promise<string | null> {
  return acmeAdmin.orderStatus(orderId);
}

export function acmeRequestLog(path: string) {
  return acmeAdmin.requestLog(path);
}

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

export async function clearIdempotency(tenantId: string): Promise<void> {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${tenantId}`;
}

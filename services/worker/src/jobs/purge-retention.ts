import { logger, serverEnv } from '@kora/core';
import { sql } from '@kora/db';

/**
 * Traces hold customer personal data by design, so they expire with the tenant's
 * retention window. Runs, steps, tool executions and evaluations cascade from the
 * conversation, so deleting it takes the whole trail.
 */
export async function purgeRetentionJob(): Promise<void> {
  const env = serverEnv();
  const days = env.KORA_RETENTION_DAYS;

  const deleted = await sql()<{ id: string }[]>`
    DELETE FROM conversations
    WHERE tenant_id = ${env.KORA_TENANT_ID}
      AND last_activity_at < now() - ${`${days} days`}::interval
    RETURNING id`;

  // Events are not cascaded: they carry the trace id, not a conversation FK, and
  // are what a lost job is replayed from.
  const events = await sql()<{ id: string }[]>`
    DELETE FROM events
    WHERE tenant_id = ${env.KORA_TENANT_ID}
      AND occurred_at < now() - ${`${days} days`}::interval
    RETURNING id`;

  if (deleted.length > 0 || events.length > 0) {
    logger().info(
      { conversations: deleted.length, events: events.length, retentionDays: days },
      'retention purge complete',
    );
  }
}

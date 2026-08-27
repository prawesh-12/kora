import { logger } from '@kora/core';

export async function cleanupIdempotencyJob(): Promise<void> {
  const { cleanupExpired } = await import('@kora/tools');
  const deleted = await cleanupExpired();
  if (deleted > 0) logger().info({ deleted }, 'idempotency cleanup');
}

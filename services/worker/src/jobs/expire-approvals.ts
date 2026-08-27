import { logger, serverEnv } from '@kora/core';

export async function expireApprovalsJob(): Promise<void> {
  const { expireOverdueApprovals } = await import('@kora/db');
  const expired = await expireOverdueApprovals(serverEnv().KORA_TENANT_ID);
  if (expired.length > 0) logger().info({ expired: expired.length }, 'approvals expired');
}

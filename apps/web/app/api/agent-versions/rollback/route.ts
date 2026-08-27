import { serverEnv } from '@kora/core';
import { rollback } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { conflict, handle } from '@/lib/api/errors';

/**
 * Rollback has no gates and needs no redeploy. It is always available, because
 * the moment you need it is the moment nobody has time to argue with a checklist.
 */
export async function POST(): Promise<Response> {
  return handle(async () => {
    const operator = await requireOperator();
    const restored = await rollback(serverEnv().KORA_TENANT_ID, operator.id);

    if (!restored) {
      throw conflict('there is no archived version to roll back to');
    }

    return Response.json({ restoredVersionId: restored.restoredVersionId });
  });
}

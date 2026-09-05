import { serverEnv } from '@kora/core';
import { rollback } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { conflict, handle } from '@/lib/api/errors';

// Deliberately ungated: rollback must stay available during an incident.
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

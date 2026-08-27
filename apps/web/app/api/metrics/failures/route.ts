import { serverEnv } from '@kora/core';
import { failureBreakdown } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { handle } from '@/lib/api/errors';
import { MetricsQuery, parseQuery, resolveWindow, toFailureBucketDto } from '@/lib/api/schemas';

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireOperator();

    const query = parseQuery(req.url, MetricsQuery);
    const { from, to } = resolveWindow(query.from, query.to);

    const buckets = await failureBreakdown({
      tenantId: serverEnv().KORA_TENANT_ID,
      from,
      to,
      ...(query.intent ? { intent: query.intent } : {}),
      ...(query.agentConfigVersion ? { agentConfigVersion: query.agentConfigVersion } : {}),
    });
    return Response.json(buckets.map(toFailureBucketDto));
  });
}

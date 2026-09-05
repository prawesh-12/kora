import { now, serverEnv } from '@kora/core';
import { assembleTrace, withTenant } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { handle, notFound } from '@/lib/api/errors';
import { toEvaluationDto, toTraceDto } from '@/lib/api/schemas';

// Defaults to the newest run for the conversation; `?runId=` picks an older one.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    await requireOperator();
    const { id } = await params;
    const tenantId = serverEnv().KORA_TENANT_ID;
    const repos = withTenant(tenantId);

    const conversation = await repos.conversations.get(id);
    if (!conversation) throw notFound('conversation');

    const requestedRunId = new URL(req.url).searchParams.get('runId');
    const runs = (await repos.runs.listBetween(conversation.startedAt, now())).filter(
      (r) => r.conversationId === id,
    );
    const run = requestedRunId ? runs.find((r) => r.id === requestedRunId) : runs[0];
    if (!run) throw notFound('run');

    const [trace, evaluation] = await Promise.all([
      assembleTrace(tenantId, run.id),
      repos.evaluations.forRun(run.id),
    ]);
    return Response.json(toTraceDto(trace, toEvaluationDto(evaluation)));
  });
}

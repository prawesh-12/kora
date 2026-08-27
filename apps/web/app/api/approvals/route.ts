import { now, serverEnv } from '@kora/core';
import { listApprovalQueue } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { badRequest, handle } from '@/lib/api/errors';
import { ApprovalsQuery, parseQuery, toQueuedApprovalDto } from '@/lib/api/schemas';

function startOfToday(): Date {
  const today = now();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireOperator();
    const query = parseQuery(req.url, ApprovalsQuery);

    if (
      query.minValueMinor !== undefined &&
      query.maxValueMinor !== undefined &&
      query.minValueMinor >= query.maxValueMinor
    ) {
      throw badRequest('`minValueMinor` must be below `maxValueMinor`');
    }

    const approvals = await listApprovalQueue(serverEnv().KORA_TENANT_ID, {
      status: query.status,
      ...(query.scope === 'today' ? { decidedSince: startOfToday() } : {}),
      ...(query.tool ? { toolName: query.tool } : {}),
      ...(query.minValueMinor !== undefined ? { minValueMinor: query.minValueMinor } : {}),
      ...(query.maxValueMinor !== undefined ? { maxValueMinor: query.maxValueMinor } : {}),
    });

    return Response.json({ approvals: approvals.map(toQueuedApprovalDto) });
  });
}

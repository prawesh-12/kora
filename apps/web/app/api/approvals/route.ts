import { serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { badRequest, handle } from '@/lib/api/errors';
import { toApprovalDto } from '@/lib/api/schemas';

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireOperator();

    const status = new URL(req.url).searchParams.get('status') ?? 'pending';
    if (status !== 'pending') throw badRequest('only status=pending is supported');

    const repos = withTenant(serverEnv().KORA_TENANT_ID);
    await repos.approvals.expireOverdue();
    const pending = await repos.approvals.listPending();

    const approvals = await Promise.all(
      pending.map(async (a) => {
        const checks = await repos.policyChecks.listForRun(a.runId);
        return toApprovalDto(a, checks.find((c) => c.id === a.policyCheckId) ?? null);
      }),
    );
    return Response.json({ approvals });
  });
}

import { runAgentTurn } from '@kora/ai';
import { isTerminalState, serverEnv } from '@kora/core';
import { readApproval, withTenant } from '@kora/db';
import { after } from 'next/server';
import { wireQueues, workerIsWired } from '@/lib/queue';
import { handle, notFound, rateLimited } from '@/lib/api/errors';
import { approvalWebhookUrl, notifyApprovalPending } from '@/lib/notify/webhook';
import { SendMessageRequest, parseBody, toTurnDto } from '@/lib/api/schemas';
import { takeMessageSlot } from '@/lib/rate-limit';

export const maxDuration = 60;

// Not a stream: the client gets one complete turn, not tokens.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { conversationId } = await params;
    const tenantId = serverEnv().KORA_TENANT_ID;

    const conversation = await withTenant(tenantId).conversations.get(conversationId);
    if (!conversation) throw notFound('conversation');

    const slot = await takeMessageSlot(conversationId);
    if (!slot.allowed) throw rateLimited(slot.retryAfterSeconds);

    await wireQueues();

    const { message } = await parseBody(req, SendMessageRequest);
    const result = await runAgentTurn({ tenantId, conversationId, message });

    // `run.finished` was already emitted, so the worker normally schedules this.
    // Running it inline is the fallback for a deployment with no worker.
    if (isTerminalState(result.finalState) && !workerIsWired()) {
      after(async () => {
        const { evaluateRun } = await import('@kora/evaluation');
        await evaluateRun({ tenantId, runId: result.runId }).catch(() => {});
      });
    }

    const webhook = approvalWebhookUrl();
    if (result.approvalId && webhook) {
      const approvalId = result.approvalId;
      after(async () => {
        const approval = await readApproval(tenantId, approvalId);
        if (!approval) return;
        await notifyApprovalPending(
          {
            approvalId: approval.id,
            conversationId: approval.conversationId,
            runId: approval.runId,
            toolName: approval.toolName,
            reason: approval.reason,
            amountMinor: approval.amountMinor,
            currency: approval.currency,
            requestedAt: approval.requestedAt.toISOString(),
            expiresAt: approval.expiresAt.toISOString(),
            url: `${serverEnv().KORA_APP_URL}/ops/approvals?focus=${approval.id}`,
          },
          webhook,
        );
      });
    }

    return Response.json(toTurnDto(result));
  });
}

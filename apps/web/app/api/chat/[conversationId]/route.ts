import { runAgentTurn } from '@kora/ai';
import { isTerminalState, serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import { after } from 'next/server';
import { handle, notFound, rateLimited } from '@/lib/api/errors';
import { SendMessageRequest, parseBody, toTurnDto } from '@/lib/api/schemas';
import { takeMessageSlot } from '@/lib/rate-limit';

export const maxDuration = 60;

/**
 * `runAgentTurn` is not a stream. It persists the customer message, runs the whole
 * turn while writing every step to the database, persists the assistant message and
 * then resolves. The client gets one complete turn, not tokens.
 */
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

    const { message } = await parseBody(req, SendMessageRequest);
    const result = await runAgentTurn({ tenantId, conversationId, message });

    if (isTerminalState(result.finalState)) {
      after(async () => {
        const { evaluateRun } = await import('@kora/evaluation');
        await evaluateRun({ tenantId, runId: result.runId }).catch(() => {});
      });
    }

    return Response.json(toTurnDto(result));
  });
}

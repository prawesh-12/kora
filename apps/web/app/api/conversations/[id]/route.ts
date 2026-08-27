import { now, serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { handle, notFound } from '@/lib/api/errors';
import { toConversationDto, toMessageDto } from '@/lib/api/schemas';
import type { ConversationDetailDto } from '@/lib/api/schemas';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    await requireOperator();
    const { id } = await params;
    const repos = withTenant(serverEnv().KORA_TENANT_ID);

    const conversation = await repos.conversations.get(id);
    if (!conversation) throw notFound('conversation');

    const [messages, runs] = await Promise.all([
      repos.messages.listForConversation(id),
      repos.runs.listBetween(conversation.startedAt, now()),
    ]);
    const latest = runs.find((r) => r.conversationId === id) ?? null;
    const pending = latest
      ? ((await repos.approvals.listForRun(latest.id)).find((a) => a.status === 'pending') ?? null)
      : null;

    const dto: ConversationDetailDto = {
      conversation: toConversationDto(conversation),
      messages: messages.map(toMessageDto),
      latestRunId: latest?.id ?? null,
      pendingApprovalId: pending?.id ?? null,
    };
    return Response.json(dto);
  });
}

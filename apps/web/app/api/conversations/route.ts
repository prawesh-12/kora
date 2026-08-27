import { serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import { handle } from '@/lib/api/errors';
import { CreateConversationRequest, parseBody } from '@/lib/api/schemas';

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const body = await parseBody(req, CreateConversationRequest);
    const repos = withTenant(serverEnv().KORA_TENANT_ID);
    const conversation = await repos.conversations.create({
      channel: 'web',
      ...(body.externalCustomerId ? { externalCustomerId: body.externalCustomerId } : {}),
    });
    return Response.json({ conversationId: conversation.id }, { status: 201 });
  });
}

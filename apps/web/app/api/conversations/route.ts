import { serverEnv } from '@kora/core';
import { decodeCursor, listConversationSummaries, withTenant } from '@kora/db';
import { requireOperator } from '@/lib/api/auth';
import { badRequest, handle } from '@/lib/api/errors';
import {
  ConversationsQuery,
  CreateConversationRequest,
  parseBody,
  parseQuery,
  toConversationSummaryDto,
} from '@/lib/api/schemas';
import type { ConversationPageDto } from '@/lib/api/schemas';

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

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireOperator();
    const query = parseQuery(req.url, ConversationsQuery);

    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (query.cursor && !cursor) {
      throw badRequest('the cursor is not one this endpoint issued; start from the first page');
    }

    const page = await listConversationSummaries({
      tenantId: serverEnv().KORA_TENANT_ID,
      limit: query.limit,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.intent ? { intent: query.intent } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.failureCode ? { failureCode: query.failureCode } : {}),
      ...(query.verified !== undefined ? { verified: query.verified } : {}),
      ...(query.escalated !== undefined ? { escalated: query.escalated } : {}),
      ...(query.escalationStatus ? { escalationStatus: query.escalationStatus } : {}),
      ...(cursor ? { cursor } : {}),
    });

    const dto: ConversationPageDto = {
      items: page.items.map(toConversationSummaryDto),
      nextCursor: page.nextCursor,
    };
    return Response.json(dto);
  });
}

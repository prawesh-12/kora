import { serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function NewChatPage() {
  const conversation = await withTenant(serverEnv().KORA_TENANT_ID).conversations.create({
    channel: 'web',
  });
  redirect(`/chat/${conversation.id}`);
}

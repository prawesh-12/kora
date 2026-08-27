import { serverEnv } from '@kora/core';
import { tenantName, withTenant } from '@kora/db';
import { ChatTranscript, type ChatMessage } from '@/components/kora/chat-transcript';

export const dynamic = 'force-dynamic';

export default async function ChatPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const tenantId = serverEnv().KORA_TENANT_ID;
  const repos = withTenant(tenantId);
  const [conversation, merchant] = await Promise.all([
    repos.conversations.get(conversationId),
    tenantName(tenantId),
  ]);

  if (!conversation) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 px-6">
        <h1 className="font-semibold text-xl">This link is not valid</h1>
        <p className="text-muted-foreground">
          The conversation does not exist. Start a new one from the home page.
        </p>
      </main>
    );
  }

  const rows = await repos.messages.listForConversation(conversationId);
  const messages: ChatMessage[] = rows
    .filter((m) => m.role === 'customer' || m.role === 'agent')
    .map((m) => ({
      id: m.id,
      role: m.role === 'customer' ? 'customer' : 'agent',
      content: m.content,
      parts: [{ key: 'text', kind: 'text', text: m.content }],
    }));

  return (
    <ChatTranscript
      conversationId={conversationId}
      initialMessages={messages}
      merchantName={merchant ?? 'Customer support'}
    />
  );
}

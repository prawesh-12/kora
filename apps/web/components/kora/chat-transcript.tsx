'use client';

import { useCallback, useEffect, useState } from 'react';
import { Message, MessageContent } from '@/components/agents/message';
import { MessageBubble, MessageBubbleContent } from '@/components/agents/message-bubble';
import { MessageScroller } from '@/components/agents/message-scroller';
import { PromptInput } from '@/components/agents/prompt-input';
import { StreamingResponse } from '@/components/agents/streaming-response';
import { ThinkingShimmer } from '@/components/agents/loading-states/thinking-shimmer';
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from '@/components/motion/animated-toast-stack';
import { EscalationNotice } from '@/components/kora/escalation-notice';
import { ProofCard, type ProofCardProps } from '@/components/kora/proof-card';
import { ToolPart, type ToolPartData } from '@/components/kora/tool-part';

export type ChatPart = { key: string } & (
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: ToolPartData }
  | { kind: 'proof'; proof: ProofCardProps }
  | { kind: 'escalation'; reason: string }
);

export interface ChatMessage {
  id: string;
  role: 'customer' | 'agent';
  content: string;
  parts: ChatPart[];
}

interface TurnResponse {
  runId: string;
  text: string;
  toolsCalled: string[];
  approvalId: string | null;
  escalationReason: string | null;
  outcome: string | null;
}

const WRITE_TOOLS = ['create_refund', 'cancel_subscription', 'change_plan', 'create_replacement'];

const PROOF_TITLES: Record<string, { verified: string; pending: string }> = {
  create_refund: { verified: 'Refund confirmed', pending: 'Refund in progress' },
  cancel_subscription: { verified: 'Cancellation confirmed', pending: 'Cancellation in progress' },
  change_plan: { verified: 'Plan change confirmed', pending: 'Plan change in progress' },
  create_replacement: { verified: 'Replacement confirmed', pending: 'Replacement in progress' },
};

function stripeIdFromText(text: string): string | null {
  const match = text.match(/\b((?:re|sub|in|ch|cus|pi)_[A-Za-z0-9]+)\b/);
  return match?.[1] ?? null;
}

interface ApiError {
  error: { code: string; message: string };
}

/**
 * The turn arrives whole rather than token by token, so there is nothing to
 * reconcile: one request in, one assistant message out.
 */
function assistantMessage(turn: TurnResponse): ChatMessage {
  const parts: ChatPart[] = [];

  const seen = new Set<string>();
  let completedWrite: string | null = null;
  for (const tool of turn.toolsCalled) {
    if (tool === 'escalate_to_human' || seen.has(tool)) continue;
    seen.add(tool);
    const awaiting = turn.approvalId !== null && WRITE_TOOLS.includes(tool);
    parts.push({
      key: `tool-${tool}`,
      kind: 'tool',
      tool: { type: tool, state: awaiting ? 'approval-requested' : 'complete' },
    });
    if (WRITE_TOOLS.includes(tool) && !awaiting) completedWrite = tool;
  }

  if (turn.escalationReason) {
    parts.push({ key: 'escalation', kind: 'escalation', reason: turn.escalationReason });
  }
  // A completed money action renders its Proof Card in the customer's own
  // language. A resolved turn with no escalation means the read-back passed, so
  // the card shows confirmed; anything else stays honestly pending.
  if (completedWrite && !turn.escalationReason && !turn.approvalId) {
    const titles = PROOF_TITLES[completedWrite] ?? {
      verified: 'Action confirmed',
      pending: 'Action in progress',
    };
    const verified = turn.outcome === 'resolved_automatically';
    parts.push({
      key: `proof-${completedWrite}`,
      kind: 'proof',
      proof: {
        status: verified ? 'verified' : 'pending',
        title: verified ? titles.verified : titles.pending,
        stripeId: stripeIdFromText(turn.text),
        compact: true,
      },
    });
  }
  if (turn.text) parts.push({ key: 'text', kind: 'text', text: turn.text });

  return { id: turn.runId, role: 'agent', content: turn.text, parts };
}

function PartView({ part }: { part: ChatPart }) {
  switch (part.kind) {
    case 'text':
      return <StreamingResponse status="complete">{part.text}</StreamingResponse>;
    case 'tool':
      return <ToolPart part={part.tool} />;
    case 'proof':
      return <ProofCard {...part.proof} />;
    case 'escalation':
      return <EscalationNotice reason={part.reason} />;
    default:
      return null;
  }
}

/**
 * Shown on an empty conversation. A customer landing on a blank page with a
 * floating text box has no way to know what this is or what it can do, so the
 * agent opens and offers the three things it actually handles.
 */
const STARTERS = ['Refund my last payment', 'Cancel my subscription', 'Why was I charged'];

export function ChatTranscript({
  conversationId,
  initialMessages,
  merchantName,
}: {
  conversationId: string;
  initialMessages: ChatMessage[];
  merchantName: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(true);
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 3 });

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const send = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || sending) return;

      const outgoing: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'customer',
        content: text,
        parts: [{ key: 'text', kind: 'text', text }],
      };
      setMessages((current) => [...current, outgoing]);
      setSending(true);

      try {
        const res = await fetch(`/api/chat/${conversationId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiError | null;
          showToast({
            title: 'That message did not go through',
            description: body?.error.message ?? 'Please try again in a moment.',
            status: 'error',
            action: { label: 'Retry', onClick: () => void send(text) },
          });
          return;
        }

        const turn = (await res.json()) as TurnResponse;
        setMessages((current) => [...current, assistantMessage(turn)]);
      } catch {
        showToast({
          title: 'We lost the connection',
          description: 'Your message was not sent. Check your connection and try again.',
          status: 'error',
          action: { label: 'Retry', onClick: () => void send(text) },
        });
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, showToast],
  );

  return (
    <main className="flex h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto w-full max-w-[720px] px-4 py-3">
          <h1 className="font-semibold text-base">{merchantName}</h1>
          <p className="text-muted-foreground text-sm">
            Refunds, cancellations and billing questions. Ask in your own words.
          </p>
        </div>
      </header>

      <MessageScroller
        className="flex-1"
        label="Conversation"
        busy={sending}
        viewportProps={{ 'aria-live': 'polite', 'aria-atomic': false }}
        contentClassName="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-8"
      >
        {messages.length === 0 ? (
          <Message from="assistant">
            <MessageContent className="flex flex-col gap-3">
              <MessageBubble align="start" variant="solid">
                <MessageBubbleContent>
                  Hi, I can help with a refund, cancelling your subscription, or a question about
                  your bill. What is going on?
                </MessageBubbleContent>
              </MessageBubble>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((starter) => (
                  <button
                    className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={sending}
                    key={starter}
                    onClick={() => void send(starter)}
                    type="button"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </MessageContent>
          </Message>
        ) : null}

        {messages.map((message) => (
          <Message key={message.id} from={message.role === 'customer' ? 'user' : 'assistant'}>
            <MessageContent className="flex flex-col gap-3">
              {message.role === 'customer' ? (
                <MessageBubble variant="solid" align="end">
                  <MessageBubbleContent>{message.content}</MessageBubbleContent>
                </MessageBubble>
              ) : (
                message.parts.map((part) => (
                  <PartView key={`${message.id}-${part.key}`} part={part} />
                ))
              )}
            </MessageContent>
          </Message>
        ))}
        {sending ? <ThinkingShimmer className="px-1 text-sm">Working on it</ThinkingShimmer> : null}
      </MessageScroller>

      <footer className="border-t bg-background">
        <div className="mx-auto w-full max-w-[720px] px-4 py-4">
          <PromptInput
            placeholder={online ? 'Tell us what happened' : 'You appear to be offline'}
            disabled={sending || !online}
            loading={sending}
            onSubmit={send}
            aria-label="Message"
          />
        </div>
      </footer>

      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed />
    </main>
  );
}

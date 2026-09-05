import { notFound } from 'next/navigation';
import { Message, MessageContent } from '@/components/agents/message';
import { MessageBubble, MessageBubbleContent } from '@/components/agents/message-bubble';
import { EvaluationPanel } from '@/components/kora/evaluation-panel';
import { HandoffPanel } from '@/components/kora/handoff-panel';
import { TraceHeaderActions } from '@/components/kora/trace-header-actions';
import { TraceProofCard } from '@/components/kora/trace-proof';
import { TraceTimeline } from '@/components/kora/trace-timeline';
import { TraceVerdict } from '@/components/kora/trace-verdict';
import { ContextCards, type ContextCardItem } from '@/components/ops/context-cards';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { humanizeEnum, truncateId } from '@/lib/ops/format';
import { loadTraceForConversation } from '@/lib/ops/data';
import type { TraceDto } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

function Conversation({ trace }: { trace: TraceDto }) {
  return (
    <div className="flex flex-col gap-4">
      {trace.messages.map((message) => (
        <Message key={message.id} from={message.role === 'customer' ? 'user' : 'assistant'}>
          <MessageContent>
            <MessageBubble
              align={message.role === 'customer' ? 'end' : 'start'}
              variant={message.role === 'customer' ? 'soft' : 'solid'}
            >
              <MessageBubbleContent>{message.content}</MessageBubbleContent>
            </MessageBubble>
          </MessageContent>
        </Message>
      ))}
    </div>
  );
}

function RetrievalAndEvaluation({ trace }: { trace: TraceDto }) {
  const chunks: ContextCardItem[] = trace.retrievals.flatMap((r) =>
    r.chunks.map((c) => ({
      id: c.chunkId,
      title: c.title,
      headingPath: c.headingPath,
      documentVersion: c.documentVersion,
      distance: c.distance,
      content: c.content,
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-2">
        <h2 className="font-medium text-sm">Retrieved knowledge</h2>
        <ContextCards items={chunks} />
      </section>
      {trace.escalation ? (
        <HandoffPanel
          reason={trace.escalation.reason}
          note={trace.escalation.note}
          handoff={trace.escalation.handoff}
        />
      ) : (
        <EvaluationPanel evaluation={trace.evaluation} runInProgress={trace.run.inProgress} />
      )}
    </div>
  );
}

export default async function TracePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ runId?: string }>;
}) {
  const [{ id }, { runId }] = await Promise.all([params, searchParams]);
  const trace = await loadTraceForConversation(id, runId);
  if (!trace) notFound();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-xl tracking-tight">Trace</h1>
          <p className="font-mono text-muted-foreground text-xs">{trace.run.traceId}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary">
              {trace.run.intent ? humanizeEnum(trace.run.intent) : 'no intent'}
            </Badge>
            <Badge variant={trace.run.outcome === 'failed' ? 'destructive' : 'outline'}>
              {trace.run.outcome ?? 'in progress'}
            </Badge>
            <Badge variant="outline">{trace.run.finalState ?? trace.conversation.state}</Badge>
            <span
              className="font-mono text-muted-foreground text-xs"
              title={trace.run.agentConfigVersion}
            >
              {trace.run.agentVersionId ? 'agent version' : 'config'}{' '}
              {truncateId(trace.run.agentConfigVersion, 12)}
            </span>
          </div>
        </div>
        <TraceHeaderActions trace={trace} />
      </header>

      <TraceVerdict trace={trace} />

      <TraceProofCard trace={trace} />

      <div className="hidden gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 className="pb-3 font-medium text-sm">Conversation</h2>
          <Conversation trace={trace} />
        </div>
        <div className="min-w-0">
          <h2 className="pb-3 font-medium text-sm">Execution</h2>
          <TraceTimeline trace={trace} />
        </div>
        <div className="min-w-0">
          <RetrievalAndEvaluation trace={trace} />
        </div>
      </div>

      <Tabs defaultValue="execution" className="lg:hidden">
        <TabsList>
          <TabsTrigger value="conversation">Conversation</TabsTrigger>
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="conversation">
          <Conversation trace={trace} />
        </TabsContent>
        <TabsContent value="execution">
          <TraceTimeline trace={trace} />
        </TabsContent>
        <TabsContent value="evidence">
          <RetrievalAndEvaluation trace={trace} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

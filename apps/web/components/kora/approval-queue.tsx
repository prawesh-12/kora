'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CodeBlock } from '@/components/agents/code-block';
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from '@/components/motion/animated-toast-stack';
import { TaskRows, type TaskRowItem } from '@/components/ops/task-rows';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ApprovalDto } from '@/lib/api/schemas';
import { formatElapsed, formatMoneyMinor } from '@/lib/ops/format';

export interface QueueItem extends ApprovalDto {
  customerMessage: string | null;
  conversation: Array<{ id: string; role: string; content: string }>;
  order: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
}

const TICK_MS = 30_000;

interface Waiting {
  elapsedMs: number;
  /** True once more of the approval window has burned than remains. */
  urgent: boolean;
}

function waitingOn(item: QueueItem, at: number): Waiting {
  const requested = new Date(item.requestedAt).getTime();
  const expires = new Date(item.expiresAt).getTime();
  const elapsedMs = Math.max(at - requested, 0);
  const ttlMs = Math.max(expires - requested, 1);
  return { elapsedMs, urgent: item.status === 'pending' && elapsedMs > ttlMs / 2 };
}

function useNowMs(): number {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAt(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return at;
}

export function ApprovalQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 3 });
  const at = useNowMs();

  const selected = items.find((a) => a.id === selectedId) ?? null;

  const rows: TaskRowItem[] = items.map((a) => {
    const waiting = waitingOn(a, at);
    const amount = formatMoneyMinor(a.amountMinor, a.currency);
    return {
      id: a.id,
      title: a.toolName.replace(/_/g, ' '),
      subtitle: a.reason,
      meta:
        a.status === 'pending'
          ? `${formatElapsed(waiting.elapsedMs)}${waiting.urgent ? ' · past half its window' : ''}`
          : a.status,
      ...(a.amountMinor !== null ? { amount } : {}),
      selected: a.id === selectedId,
      urgent: waiting.urgent,
    };
  });

  async function decide(decision: 'approved' | 'denied') {
    if (!selected || busy) return;
    setBusy(true);

    try {
      const res = await fetch(`/api/approvals/${selected.id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(note.trim() ? { note: note.trim() } : {}) }),
      });

      if (res.status === 409 || res.status === 410) {
        const body = (await res.json()) as { error: { message: string } };
        showToast({
          title: res.status === 410 ? 'This one expired' : 'Already decided',
          description: body.error.message,
          status: 'info',
        });
        router.refresh();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        showToast({
          title: 'That decision did not go through',
          description: body?.error?.message ?? 'Please try again.',
          status: 'error',
        });
        return;
      }

      showToast({
        title: decision === 'approved' ? 'Approved' : 'Denied',
        description:
          decision === 'approved'
            ? 'The run resumed and finished.'
            : 'The run was handed to a person.',
        status: 'success',
      });
      setNote('');
      router.refresh();
    } catch {
      showToast({ title: 'We could not reach the server', status: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const selectedWaiting = selected ? waitingOn(selected, at) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="min-w-0">
        <TaskRows items={rows} onSelect={setSelectedId} emptyLabel="Nothing matches this filter" />
      </div>

      {selected ? (
        <div className="min-w-0 space-y-4" data-testid="approval-detail">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="font-medium font-mono">{selected.toolName}</span>
              {selected.amountMinor !== null ? (
                <span data-testid="approval-amount" className="font-semibold text-2xl tabular-nums">
                  {formatMoneyMinor(selected.amountMinor, selected.currency)}
                </span>
              ) : null}
            </div>
            <p className="pt-2 text-muted-foreground text-sm">{selected.reason}</p>
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <Badge variant={selected.status === 'pending' ? 'outline' : 'secondary'}>
                {selected.status}
              </Badge>
              {selected.ruleId ? <Badge variant="outline">{selected.ruleId}</Badge> : null}
              {selected.policyVersion ? (
                <Badge variant="outline">{selected.policyVersion}</Badge>
              ) : null}
              {selectedWaiting ? (
                <span
                  data-testid="approval-elapsed"
                  className={
                    selectedWaiting.urgent ? 'font-medium text-destructive text-xs' : 'text-xs'
                  }
                >
                  requested {formatElapsed(selectedWaiting.elapsedMs)}
                </span>
              ) : null}
              <Link
                href={`/ops/conversations/${selected.conversationId}?runId=${selected.runId}`}
                className="text-sm underline underline-offset-4"
              >
                Open the trace
              </Link>
            </div>
            {selected.decidedAt ? (
              <p className="pt-2 text-muted-foreground text-xs">
                {selected.status} by {selected.decidedByName ?? selected.decidedBy ?? 'the system'}
                {selected.decisionNote ? ` — ${selected.decisionNote}` : ''}
              </p>
            ) : null}
          </div>

          <CodeBlock
            code={JSON.stringify(selected.proposedInput, null, 2)}
            language="json"
            filename="proposed arguments"
            maxHeight={220}
          />

          {selected.order ? (
            <CodeBlock
              code={JSON.stringify(selected.order, null, 2)}
              language="json"
              filename="order"
              maxHeight={220}
            />
          ) : null}

          {selected.customer ? (
            <CodeBlock
              code={JSON.stringify(selected.customer, null, 2)}
              language="json"
              filename="customer"
              maxHeight={180}
            />
          ) : null}

          <section className="space-y-2">
            <h2 className="font-medium text-sm">Conversation so far</h2>
            <ul className="space-y-2">
              {selected.conversation.map((m) => (
                <li key={m.id} className="rounded-md border p-3 text-sm">
                  <p className="text-muted-foreground text-xs">{m.role}</p>
                  <p>{m.content}</p>
                </li>
              ))}
            </ul>
          </section>

          {selected.status === 'pending' ? (
            <>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why are you denying this? Stored with the decision."
                aria-label="Decision note"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => decide('approved')} disabled={busy}>
                  Approve
                </Button>
                <Button variant="destructive" onClick={() => decide('denied')} disabled={busy}>
                  Deny
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              This approval is {selected.status} and is kept for the record. Approvals are never
              deleted.
            </p>
          )}
        </div>
      ) : null}

      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed />
    </div>
  );
}

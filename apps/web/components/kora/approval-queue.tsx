'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
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

export interface QueueItem extends ApprovalDto {
  customerMessage: string | null;
  conversation: Array<{ id: string; role: string; content: string }>;
  order: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
}

function formatMoney(amountMinor: number | null, currency: string | null): string | undefined {
  if (amountMinor === null) return undefined;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency ?? 'INR',
  }).format(amountMinor / 100);
}

export function ApprovalQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 3 });

  const selected = items.find((a) => a.id === selectedId) ?? null;

  const rows: TaskRowItem[] = items.map((a) => ({
    id: a.id,
    title: a.toolName.replace(/_/g, ' '),
    subtitle: a.reason,
    meta: a.ruleId ?? 'no rule recorded',
    ...(formatMoney(a.amountMinor, a.currency)
      ? { amount: formatMoney(a.amountMinor, a.currency) as string }
      : {}),
    selected: a.id === selectedId,
  }));

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
        showToast({ title: 'Already decided', description: body.error.message, status: 'info' });
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="min-w-0">
        <TaskRows
          items={rows}
          onSelect={setSelectedId}
          emptyLabel="Nothing waiting for a decision"
        />
      </div>

      {selected ? (
        <div className="min-w-0 space-y-4" data-testid="approval-detail">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="font-medium font-mono">{selected.toolName}</span>
              {selected.amountMinor !== null ? (
                <span data-testid="approval-amount" className="font-semibold text-2xl tabular-nums">
                  {formatMoney(selected.amountMinor, selected.currency)}
                </span>
              ) : null}
            </div>
            <p className="pt-2 text-muted-foreground text-sm">{selected.reason}</p>
            <div className="flex flex-wrap gap-2 pt-3">
              {selected.ruleId ? <Badge variant="outline">{selected.ruleId}</Badge> : null}
              {selected.policyVersion ? (
                <Badge variant="outline">{selected.policyVersion}</Badge>
              ) : null}
              <Link
                href={`/ops/conversations/${selected.conversationId}?runId=${selected.runId}`}
                className="text-sm underline underline-offset-4"
              >
                Open the trace
              </Link>
            </div>
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
        </div>
      ) : null}

      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed />
    </div>
  );
}

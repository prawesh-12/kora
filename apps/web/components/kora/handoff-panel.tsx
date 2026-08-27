'use client';

import { CodeBlock } from '@/components/agents/code-block';
import { Badge } from '@/components/ui/badge';

interface HandoffAction {
  tool?: string;
  input?: unknown;
  output?: unknown;
  verified?: boolean | null;
  at?: string;
  decision?: string;
  ruleId?: string;
  reason?: string;
}

interface Handoff {
  customer?: { id: string; name: string; email: string } | null;
  conversation?: Array<{ role: string; content: string; at: string }>;
  intent?: { value: string; confidence: number; evidence: string } | null;
  retrievedPolicy?: Array<{
    title: string;
    headingPath: string;
    excerpt: string;
    documentVersion: number;
  }>;
  actionsExecuted?: HandoffAction[];
  actionsBlocked?: HandoffAction[];
  escalation?: { reason: string; note?: string };
  traceId?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-sm">{title}</h3>
      {children}
    </section>
  );
}

export function HandoffPanel({
  reason,
  note,
  handoff,
}: {
  reason: string;
  note: string | null;
  handoff: Record<string, unknown>;
}) {
  const payload = handoff as Handoff;

  return (
    <div data-testid="handoff-panel" className="space-y-5 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium font-mono text-xs uppercase tracking-wide">Handed off</span>
        <Badge variant="destructive">{reason}</Badge>
      </div>
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}

      {payload.customer ? (
        <Section title="Customer">
          <p className="text-sm">
            {payload.customer.name} · {payload.customer.email}
          </p>
        </Section>
      ) : null}

      {payload.intent ? (
        <Section title="Intent">
          <p className="text-sm">
            <span className="font-mono">{payload.intent.value}</span>{' '}
            <span className="text-muted-foreground tabular-nums">
              conf {payload.intent.confidence.toFixed(2)}
            </span>
          </p>
          <p className="text-muted-foreground text-sm">{payload.intent.evidence}</p>
        </Section>
      ) : null}

      {payload.retrievedPolicy && payload.retrievedPolicy.length > 0 ? (
        <Section title="Policy the agent read">
          <ul className="space-y-2">
            {payload.retrievedPolicy.map((p) => (
              <li key={`${p.title}-${p.headingPath}`} className="rounded-md border p-3 text-sm">
                <p className="font-medium">{p.title}</p>
                <p className="text-muted-foreground text-xs">
                  {p.headingPath} · v{p.documentVersion}
                </p>
                <p className="pt-1 text-muted-foreground">{p.excerpt}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {payload.actionsExecuted && payload.actionsExecuted.length > 0 ? (
        <Section title="Actions executed">
          <div className="space-y-2">
            {payload.actionsExecuted.map((a) => (
              <CodeBlock
                key={`${a.tool}-${a.at}`}
                code={JSON.stringify(a, null, 2)}
                language="json"
                filename={a.tool ?? 'action'}
                maxHeight={200}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {payload.actionsBlocked && payload.actionsBlocked.length > 0 ? (
        <Section title="Actions blocked">
          <ul className="space-y-2">
            {payload.actionsBlocked.map((a) => (
              <li
                key={`${a.tool}-${a.ruleId}`}
                data-testid="handoff-blocked-action"
                className="rounded-md border border-l-4 border-l-amber-500 p-3 text-sm"
              >
                <p className="font-mono">{a.tool}</p>
                <p className="text-muted-foreground text-xs">
                  {a.decision} · {a.ruleId}
                </p>
                <p className="pt-1">{a.reason}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {payload.traceId ? (
        <p className="text-muted-foreground text-xs">
          trace <span className="font-mono">{payload.traceId}</span>
        </p>
      ) : null}
    </div>
  );
}

'use client';

import { CodeBlock } from '@/components/agents/code-block';
import { StateLegend } from '@/components/kora/state-legend';
import { StatusPill } from '@/components/kora/status-pill';
import { EMPTY, formatDuration, formatUsd, humanizeEnum } from '@/lib/ops/format';
import { cn } from '@/lib/utils';
import type { PolicyCheckDto, RunStepDto, ToolExecutionDto, TraceDto } from '@/lib/api/schemas';

/**
 * "We chose not to" and "it failed" are the two things an operator most often
 * confuses in a trace. Every status therefore carries a dot AND a word, and the
 * legend below the timeline names each one. An undocumented colour is
 * decoration.
 */
const STATUS: Record<string, { dot: string; label: string }> = {
  ok: { dot: 'bg-success', label: 'executed' },
  replayed: { dot: 'bg-info', label: 'replayed' },
  simulated: { dot: 'bg-info', label: 'simulated, nothing was written' },
  awaiting_approval: { dot: 'bg-warning', label: 'waiting on a person' },
  denied: { dot: 'bg-warning', label: 'denied by policy, never ran' },
  invalid_input: { dot: 'bg-destructive', label: 'rejected, bad arguments' },
  failed: { dot: 'bg-destructive', label: 'failed' },
};

function statusOf(status: string) {
  return STATUS[status] ?? { dot: 'bg-muted-foreground', label: humanizeEnum(status) };
}

function Dot({ status }: { status: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', statusOf(status).dot)} />;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

const MAX_SCALAR = 28;
const MAX_ID = 14;

function shortScalar(text: string): string {
  if (/^(sub|re|in|ch|cus|pi|price|prod)_/i.test(text) && text.length > MAX_ID) {
    return `${text.slice(0, MAX_ID)}…`;
  }
  return text.length > MAX_SCALAR ? `${text.slice(0, MAX_SCALAR)}…` : text;
}

function scalars(value: unknown, limit: number): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') {
    return [shortScalar(String(value))];
  }
  const out: string[] = [];
  for (const item of Object.values(value as Record<string, unknown>)) {
    if (out.length >= limit) break;
    out.push(...scalars(item, limit - out.length));
  }
  return out.slice(0, limit);
}

/**
 * `get_subscription(sub_1S...) -> active` instead of forty lines of JSON. The
 * JSON is still one click away; it is just no longer the default, because three
 * open panes in a scrolling column hide the thing they are evidence for.
 */
function summarize(execution: ToolExecutionDto): string {
  const args = scalars(execution.input, 2).join(', ');
  const call = args ? `${execution.toolName}(${args})` : `${execution.toolName}()`;
  if (execution.status === 'failed') return `${call} -> ${execution.errorCode ?? 'error'}`;
  const result = scalars(execution.output, 3).join(', ');
  return result ? `${call} -> ${result}` : call;
}

/** A tool call and the policy checks that gated it, in one card. */
interface Call {
  kind: 'tool';
  id: string;
  execution: ToolExecutionDto;
  checks: PolicyCheckDto[];
}

type Item =
  | Call
  | { kind: 'step'; id: string; step: RunStepDto }
  | { kind: 'policy'; id: string; check: PolicyCheckDto };

interface Group {
  state: string;
  durationMs: number | null;
  items: Item[];
}

function buildGroups(trace: TraceDto): Group[] {
  const toolByStep = new Map(
    trace.toolExecutions.filter((e) => e.stepId).map((e) => [e.stepId, e]),
  );
  const checksByStep = new Map<string, PolicyCheckDto[]>();
  for (const check of trace.policyChecks) {
    if (!check.stepId) continue;
    const list = checksByStep.get(check.stepId) ?? [];
    list.push(check);
    checksByStep.set(check.stepId, list);
  }

  const groups: Group[] = [{ state: '', durationMs: null, items: [] }];
  const usedTools = new Set<string>();
  const usedChecks = new Set<string>();
  const current = () => groups[groups.length - 1] as Group;

  for (const step of trace.steps) {
    if (step.kind === 'state') {
      const state = typeof step.payload.state === 'string' ? step.payload.state : 'unknown';
      groups.push({ state, durationMs: step.durationMs, items: [] });
      continue;
    }

    const checks = checksByStep.get(step.id) ?? [];
    const execution = toolByStep.get(step.id);

    if (execution) {
      usedTools.add(execution.id);
      for (const check of checks) usedChecks.add(check.id);
      // The check that blocked create_replacement belongs inside that card, not
      // in a flat list five rows below it.
      current().items.push({ kind: 'tool', id: execution.id, execution, checks });
      continue;
    }

    current().items.push({ kind: 'step', id: step.id, step });
    for (const check of checks) {
      usedChecks.add(check.id);
      current().items.push({ kind: 'policy', id: check.id, check });
    }
  }

  for (const execution of trace.toolExecutions) {
    if (usedTools.has(execution.id)) continue;
    current().items.push({ kind: 'tool', id: execution.id, execution, checks: [] });
  }
  for (const check of trace.policyChecks) {
    if (usedChecks.has(check.id)) continue;
    current().items.push({ kind: 'policy', id: check.id, check });
  }

  // A state heading with nothing under it is a label for an empty region.
  return groups.filter((group) => group.items.length > 0);
}

function PolicyDetail({ check, nested }: { check: PolicyCheckDto; nested?: boolean }) {
  const tone = check.decision === 'allow' ? 'ok' : check.decision === 'deny' ? 'danger' : 'warn';
  return (
    <div className={cn('space-y-2 text-xs', nested && 'rounded-md border bg-muted/30 p-3')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">policy check</span>
        <StatusPill status={tone}>{humanizeEnum(check.decision)}</StatusPill>
        <span className="font-mono">{check.ruleId}</span>
      </div>
      <p>{check.reason}</p>
      <p className="font-mono text-muted-foreground">
        {check.policyKey} {check.policyVersion}
        {check.missingFacts.length > 0 ? ` · missing ${check.missingFacts.join(', ')}` : ''}
      </p>
      <details>
        <summary className="cursor-pointer text-muted-foreground">facts the rule saw</summary>
        <div className="pt-2">
          <CodeBlock code={json(check.facts)} language="json" maxHeight={180} wrap />
        </div>
      </details>
    </div>
  );
}

function ToolCard({ execution, checks }: Call) {
  const failed = execution.status === 'failed';
  return (
    <details className="rounded-md border bg-card" data-testid={`trace-tool-${execution.status}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <Dot status={execution.status} />
        <span className="min-w-0 truncate font-mono">{summarize(execution)}</span>
        <span className="text-muted-foreground text-xs">{statusOf(execution.status).label}</span>
        {execution.verified === false ? <StatusPill status="danger">unverified</StatusPill> : null}
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          {formatDuration(execution.durationMs)}
        </span>
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {checks.map((check) => (
          <PolicyDetail check={check} key={check.id} nested />
        ))}
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-xs">
          <dt className="text-muted-foreground">attempt</dt>
          <dd className="tabular-nums">{execution.attempt}</dd>
          <dt className="text-muted-foreground">idempotency</dt>
          <dd className="truncate font-mono">{execution.idempotencyKey ?? EMPTY}</dd>
          {failed ? (
            <>
              <dt className="text-muted-foreground">error code</dt>
              <dd className="font-mono">{execution.errorCode ?? EMPTY}</dd>
              <dt className="text-muted-foreground">error</dt>
              <dd className="break-words">{execution.errorMessage ?? EMPTY}</dd>
            </>
          ) : null}
        </dl>
        <CodeBlock
          code={json(execution.input)}
          filename="input"
          language="json"
          maxHeight={220}
          wrap
        />
        <CodeBlock
          code={json(failed ? execution.errorMessage : execution.output)}
          filename={failed ? 'upstream response' : 'output'}
          language="json"
          maxHeight={220}
          wrap
        />
        {execution.verifyObserved !== null && execution.verifyObserved !== undefined ? (
          <CodeBlock
            code={json(execution.verifyObserved)}
            filename="read-back"
            language="json"
            maxHeight={180}
            wrap
          />
        ) : null}
      </div>
    </details>
  );
}

function StepCard({ step }: { step: RunStepDto }) {
  const failed = step.status === 'failed';
  return (
    <details className="rounded-md border bg-card" data-testid={`trace-step-${step.kind}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <Dot status={failed ? 'failed' : 'ok'} />
        <span>{humanizeEnum(step.kind)}</span>
        {failed ? <StatusPill status="danger">failed</StatusPill> : null}
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          {formatDuration(step.durationMs)}
        </span>
      </summary>
      <div className="border-t px-3 py-3">
        <CodeBlock code={json(step.payload)} language="json" maxHeight={220} wrap />
      </div>
    </details>
  );
}

export function TraceTimeline({ trace }: { trace: TraceDto }) {
  const groups = buildGroups(trace);

  return (
    <div className="flex flex-col gap-2">
      {trace.run.inProgress ? (
        <p
          className="flex items-center gap-2 text-muted-foreground text-sm"
          data-testid="trace-live-indicator"
        >
          <span aria-hidden className="inline-block size-2 animate-pulse rounded-full bg-info" />
          This run is still in progress.
        </p>
      ) : null}

      {groups.map((group) => (
        <div className="flex flex-col gap-2" key={group.state || 'ungrouped'}>
          {group.state ? (
            <div
              className="flex items-baseline gap-2 pt-3 font-medium text-muted-foreground text-xs uppercase tracking-[0.06em]"
              data-testid="trace-state"
            >
              <span className="font-mono">{group.state}</span>
              <span className="tabular-nums">{formatDuration(group.durationMs)}</span>
            </div>
          ) : null}
          {group.items.map((item) =>
            item.kind === 'tool' ? (
              <ToolCard {...item} key={item.id} />
            ) : item.kind === 'policy' ? (
              <div
                className="rounded-md border bg-card px-3 py-2"
                key={item.id}
                data-testid={`trace-policy-${item.check.decision}`}
              >
                <PolicyDetail check={item.check} />
              </div>
            ) : (
              <StepCard key={item.id} step={item.step} />
            ),
          )}
        </div>
      ))}

      <StateLegend className="pt-4" />

      <p className="text-muted-foreground text-xs tabular-nums">
        {trace.run.stepCount} steps · {formatDuration(trace.totals.durationMs)} ·{' '}
        {(trace.totals.tokensIn + trace.totals.tokensOut).toLocaleString()} tokens ·{' '}
        {formatUsd(trace.totals.costUsdMicros)}
      </p>
    </div>
  );
}

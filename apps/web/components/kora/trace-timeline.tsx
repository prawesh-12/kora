'use client';

import { CodeBlock } from '@/components/agents/code-block';
import { Badge } from '@/components/ui/badge';
import { formatDuration } from '@/lib/ops/format';
import { cn } from '@/lib/utils';
import type { PolicyCheckDto, RunStepDto, ToolExecutionDto, TraceDto } from '@/lib/api/schemas';

type Entry =
  | { kind: 'state'; id: string; state: string; durationMs: number | null }
  | { kind: 'step'; id: string; step: RunStepDto }
  | { kind: 'tool'; id: string; execution: ToolExecutionDto }
  | { kind: 'policy'; id: string; check: PolicyCheckDto };

/**
 * "We chose not to" and "it failed" are the two things an operator most often
 * confuses in a trace, so denied, simulated, failed and executed rows each get
 * their own tone and their own test id.
 */
const TOOL_TONE: Record<string, string> = {
  ok: 'border-l-emerald-500',
  replayed: 'border-l-sky-500',
  simulated: 'border-l-violet-500',
  denied: 'border-l-amber-500',
  failed: 'border-l-destructive',
};

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function buildEntries(trace: TraceDto): Entry[] {
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

  const entries: Entry[] = [];
  const usedTools = new Set<string>();
  const usedChecks = new Set<string>();

  for (const step of trace.steps) {
    if (step.kind === 'state') {
      const state = typeof step.payload.state === 'string' ? step.payload.state : 'unknown';
      entries.push({ kind: 'state', id: step.id, state, durationMs: step.durationMs });
      continue;
    }

    const execution = toolByStep.get(step.id);
    if (execution) {
      usedTools.add(execution.id);
      entries.push({ kind: 'tool', id: execution.id, execution });
    } else {
      entries.push({ kind: 'step', id: step.id, step });
    }

    for (const check of checksByStep.get(step.id) ?? []) {
      usedChecks.add(check.id);
      entries.push({ kind: 'policy', id: check.id, check });
    }
  }

  for (const execution of trace.toolExecutions) {
    if (!usedTools.has(execution.id)) entries.push({ kind: 'tool', id: execution.id, execution });
  }
  for (const check of trace.policyChecks) {
    if (!usedChecks.has(check.id)) entries.push({ kind: 'policy', id: check.id, check });
  }

  return entries;
}

function ToolRow({ execution }: { execution: ToolExecutionDto }) {
  const failed = execution.status === 'failed';
  return (
    <details
      data-testid={`trace-tool-${execution.status}`}
      className={cn('rounded-md border border-l-4 bg-card', TOOL_TONE[execution.status] ?? '')}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-medium font-mono">{execution.toolName}</span>
        <Badge variant={failed ? 'destructive' : 'secondary'}>{execution.status}</Badge>
        {execution.verified !== null ? (
          <Badge variant={execution.verified ? 'default' : 'destructive'}>
            {execution.verified ? 'verified' : 'unverified'}
          </Badge>
        ) : null}
        <span className="ml-auto text-muted-foreground tabular-nums">
          {formatDuration(execution.durationMs)}
        </span>
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <dt className="text-muted-foreground">attempt</dt>
          <dd className="tabular-nums">{execution.attempt}</dd>
          <dt className="text-muted-foreground">idempotency</dt>
          <dd className="truncate font-mono">{execution.idempotencyKey ?? '—'}</dd>
          {failed ? (
            <>
              <dt className="text-muted-foreground">error code</dt>
              <dd className="font-mono">{execution.errorCode ?? '—'}</dd>
              <dt className="text-muted-foreground">error</dt>
              <dd className="col-span-3 break-words">{execution.errorMessage ?? '—'}</dd>
            </>
          ) : null}
        </dl>
        <CodeBlock code={json(execution.input)} language="json" filename="input" maxHeight={220} />
        <CodeBlock
          code={json(failed ? execution.errorMessage : execution.output)}
          language="json"
          filename={failed ? 'upstream response' : 'output'}
          maxHeight={220}
        />
        {execution.verifyObserved !== null && execution.verifyObserved !== undefined ? (
          <CodeBlock
            code={json(execution.verifyObserved)}
            language="json"
            filename="read-back"
            maxHeight={180}
          />
        ) : null}
      </div>
    </details>
  );
}

function PolicyRow({ check }: { check: PolicyCheckDto }) {
  return (
    <details data-testid={`trace-policy-${check.decision}`} className="rounded-md border bg-card">
      <summary className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm cursor-pointer">
        <span className="text-muted-foreground">policy check</span>
        <span className="font-medium font-mono">{check.action}</span>
        <Badge variant={check.decision === 'allow' ? 'secondary' : 'destructive'}>
          {check.decision}
        </Badge>
      </summary>
      <div className="space-y-3 border-t px-3 py-3 text-xs">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">rule</dt>
          <dd className="font-mono">{check.ruleId}</dd>
          <dt className="text-muted-foreground">policy</dt>
          <dd className="font-mono">
            {check.policyKey} {check.policyVersion}
          </dd>
          <dt className="text-muted-foreground">reason</dt>
          <dd>{check.reason}</dd>
          {check.missingFacts.length > 0 ? (
            <>
              <dt className="text-muted-foreground">missing facts</dt>
              <dd className="font-mono">{check.missingFacts.join(', ')}</dd>
            </>
          ) : null}
        </dl>
        <CodeBlock code={json(check.facts)} language="json" filename="facts" maxHeight={180} />
      </div>
    </details>
  );
}

function StepRow({ step }: { step: RunStepDto }) {
  const failed = step.status === 'failed';
  return (
    <details
      data-testid={`trace-step-${step.kind}`}
      className={cn('rounded-md border bg-card', failed && 'border-l-4 border-l-destructive')}
    >
      <summary className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm cursor-pointer">
        <span className="font-medium">{step.kind}</span>
        {failed ? <Badge variant="destructive">failed</Badge> : null}
        <span className="ml-auto text-muted-foreground tabular-nums">
          {formatDuration(step.durationMs)}
        </span>
      </summary>
      <div className="border-t px-3 py-3">
        <CodeBlock code={json(step.payload)} language="json" maxHeight={220} />
      </div>
    </details>
  );
}

export function TraceTimeline({ trace }: { trace: TraceDto }) {
  const entries = buildEntries(trace);

  return (
    <div className="flex flex-col gap-2">
      {trace.run.inProgress ? (
        <p
          data-testid="trace-live-indicator"
          className="flex items-center gap-2 text-muted-foreground text-sm"
        >
          <span className="inline-block size-2 animate-pulse rounded-full bg-sky-500" aria-hidden />
          This run is still in progress.
        </p>
      ) : null}

      {entries.map((entry) => {
        if (entry.kind === 'state') {
          return (
            <div
              key={entry.id}
              data-testid="trace-state"
              className="pt-3 font-medium font-mono text-muted-foreground text-xs uppercase tracking-wide"
            >
              {entry.state}
            </div>
          );
        }
        if (entry.kind === 'tool') return <ToolRow key={entry.id} execution={entry.execution} />;
        if (entry.kind === 'policy') return <PolicyRow key={entry.id} check={entry.check} />;
        return <StepRow key={entry.id} step={entry.step} />;
      })}

      <p className="pt-3 text-muted-foreground text-xs tabular-nums">
        {trace.run.stepCount} steps · {formatDuration(trace.totals.durationMs)} ·{' '}
        {trace.totals.tokensIn + trace.totals.tokensOut} tokens · $
        {(trace.totals.costUsdMicros / 1_000_000).toFixed(4)}
      </p>
    </div>
  );
}

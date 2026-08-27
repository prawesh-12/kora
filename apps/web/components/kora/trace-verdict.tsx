import { humanizeEnum } from '@/lib/ops/format';
import { cn } from '@/lib/utils';
import type { TraceDto } from '@/lib/api/schemas';

type Tone = 'ok' | 'warn' | 'danger' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-success/40 bg-success/5 text-success',
  warn: 'border-warning/40 bg-warning/5 text-warning',
  danger: 'border-destructive/40 bg-destructive/5 text-destructive',
  muted: 'border-border bg-muted/40 text-muted-foreground',
};

interface Verdict {
  tone: Tone;
  label: string;
  headline: string;
  /** The rule and policy that produced it, when a rule produced it. */
  provenance?: string;
  /** The raw value behind a humanized headline, for the title attribute. */
  raw?: string;
}

/**
 * `insufficient facts: exceedsRemaining,` is the rule engine talking to itself.
 * The operator gets the sentence; the raw string survives in a title attribute
 * for anyone who needs to grep for it.
 */
function humanizeMissingFacts(facts: string[]): string {
  if (facts.length === 0) return '';
  const names = facts.map((fact) =>
    fact
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim(),
  );
  return `missing ${names.join(', ')}`;
}

/**
 * The one sentence the operator opened this page for. Everything below is the
 * evidence for it, which is why it sits above the columns rather than inside
 * one of them.
 */
export function traceVerdict(trace: TraceDto): Verdict {
  const denied = trace.policyChecks.find((c) => c.decision === 'deny');
  if (denied) {
    return {
      tone: 'danger',
      label: 'Blocked',
      headline:
        denied.missingFacts.length > 0
          ? `${denied.reason} (${humanizeMissingFacts(denied.missingFacts)})`
          : denied.reason,
      provenance: `rule ${denied.ruleId} · policy ${denied.policyKey} ${denied.policyVersion}`,
      raw: denied.missingFacts.join(', ') || undefined,
    };
  }

  const held = trace.policyChecks.find((c) => c.decision === 'require_approval');
  if (held) {
    return {
      tone: 'warn',
      label: 'Held for approval',
      headline: held.reason,
      provenance: `rule ${held.ruleId} · policy ${held.policyKey} ${held.policyVersion}`,
    };
  }

  if (trace.run.outcome === 'failed') {
    const broken = trace.toolExecutions.find((e) => e.status === 'failed');
    return {
      tone: 'danger',
      label: 'Failed',
      headline: broken
        ? `${broken.toolName} did not return a result: ${broken.errorMessage ?? humanizeEnum(broken.errorCode)}`
        : (trace.run.errorCode ?? 'The run stopped before it reached an outcome.'),
      raw: broken?.errorCode ?? trace.run.errorCode ?? undefined,
    };
  }

  if (trace.escalation) {
    return {
      tone: 'warn',
      label: 'Handed to a person',
      headline: trace.escalation.note ?? humanizeEnum(trace.escalation.reason),
      raw: trace.escalation.reason,
    };
  }

  if (trace.run.inProgress) {
    return {
      tone: 'muted',
      label: 'Running',
      headline: `Still working. Currently in ${humanizeEnum(trace.run.finalState ?? trace.conversation.state)}.`,
    };
  }

  if (trace.run.outcome === 'resolved_automatically') {
    const verified = trace.evaluation?.verifiedResolution;
    return {
      tone: verified === false ? 'warn' : 'ok',
      label: 'Resolved',
      headline:
        verified === false
          ? 'The agent resolved this, but the evaluator could not verify the outcome.'
          : 'The agent resolved this end to end and the outcome was verified.',
    };
  }

  return {
    tone: 'muted',
    label: humanizeEnum(trace.run.outcome ?? 'no outcome'),
    headline: `The run ended in ${humanizeEnum(trace.run.finalState ?? trace.conversation.state)}.`,
  };
}

export function TraceVerdict({ trace }: { trace: TraceDto }) {
  const verdict = traceVerdict(trace);

  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[10px] border px-5 py-4',
        TONE_CLASS[verdict.tone],
      )}
      data-testid="trace-verdict"
      role="status"
    >
      <span className="font-semibold text-sm uppercase tracking-[0.06em]">{verdict.label}</span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-foreground text-sm" title={verdict.raw}>
          {verdict.headline}
        </p>
        {verdict.provenance ? (
          <p className="font-mono text-muted-foreground text-xs">{verdict.provenance}</p>
        ) : null}
      </div>
    </div>
  );
}

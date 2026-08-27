import { cn } from '@/lib/utils';

/**
 * One scale for every status in the product.
 *
 * Black used to mean pass. Black is the neutral surface everywhere else in this
 * palette, so it cannot also mean success, and three screens rendered the same
 * three verified states three unrelated ways.
 *
 * Built by hand rather than taken from a registry: it is a span with a token
 * class and a lookup table, and the badge primitive it wraps is already
 * installed. See docs/decisions.md.
 */
export type Status = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

const STATUS_CLASS: Record<Status, string> = {
  ok: 'bg-success/10 text-success',
  warn: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  muted: 'bg-muted text-muted-foreground',
};

export function StatusPill({
  status,
  children,
  className,
  title,
}: {
  status: Status;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 font-medium text-xs',
        STATUS_CLASS[status],
        className,
      )}
      title={title}
    >
      {children}
    </span>
  );
}

/** Verified resolution: pass, fail, or not judged yet. Never black for pass. */
export function VerifiedPill({ verified }: { verified: boolean | null }) {
  if (verified === null) {
    return (
      <StatusPill status="muted" title="This run has not been evaluated yet">
        evaluating
      </StatusPill>
    );
  }
  return <StatusPill status={verified ? 'ok' : 'danger'}>{verified ? 'pass' : 'fail'}</StatusPill>;
}

const DECISION_STATUS: Record<string, Status> = {
  allow: 'ok',
  require_approval: 'warn',
  deny: 'danger',
};

export function PolicyPill({ decision }: { decision: string | null }) {
  if (!decision) return <StatusPill status="muted">no decision</StatusPill>;
  return (
    <StatusPill status={DECISION_STATUS[decision] ?? 'muted'}>
      {decision.replace(/_/g, ' ')}
    </StatusPill>
  );
}

const STATE_STATUS: Record<string, Status> = {
  RESOLVED: 'ok',
  AWAITING_APPROVAL: 'warn',
  NEEDS_HUMAN: 'warn',
  FAILED: 'danger',
};

export function StatePill({ state }: { state: string | null }) {
  if (!state) return <StatusPill status="muted">in progress</StatusPill>;
  return (
    <StatusPill status={STATE_STATUS[state] ?? 'muted'}>
      {state.toLowerCase().replace(/_/g, ' ')}
    </StatusPill>
  );
}

const EXECUTION_STATUS: Record<string, Status> = {
  ok: 'ok',
  replayed: 'info',
  simulated: 'info',
  awaiting_approval: 'warn',
  denied: 'danger',
  failed: 'danger',
  invalid_input: 'danger',
};

export function ExecutionPill({ status }: { status: string }) {
  return (
    <StatusPill status={EXECUTION_STATUS[status] ?? 'muted'}>
      {status.replace(/_/g, ' ')}
    </StatusPill>
  );
}

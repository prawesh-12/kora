import { cn } from '@/lib/utils';

export type Status = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

const STATUS_CLASS: Record<Status, string> = {
  ok: 'bg-success/10 text-success-strong',
  warn: 'bg-warning/10 text-warning-strong',
  danger: 'bg-destructive/10 text-destructive-strong',
  info: 'bg-info/10 text-info-strong',
  muted: 'bg-muted text-muted-strong',
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

/** A run in AWAITING_APPROVAL reads as pending, not fail: the evaluator scored it
 *  against a resolution that has not been allowed to happen yet. */
export function VerifiedPill({
  verified,
  state,
}: {
  verified: boolean | null;
  state?: string | null;
}) {
  if (state === 'AWAITING_APPROVAL') {
    return (
      <StatusPill status="muted" title="Waiting on a person to approve the action">
        pending
      </StatusPill>
    );
  }
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

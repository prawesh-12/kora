import { ProofCard, type ProofCardProps } from '@/components/kora/proof-card';
import type { TraceDto } from '@/lib/api/schemas';

const WRITE_TOOLS = ['create_refund', 'cancel_subscription', 'change_plan'];

function stripeIdFrom(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  for (const key of ['refundId', 'id', 'subscriptionId', 'invoiceId', 'chargeId']) {
    const value = record[key];
    if (typeof value === 'string' && /^(re|sub|in|ch|cus|pi)_/.test(value)) return value;
  }
  return null;
}

function amountFrom(facts: Record<string, unknown>): {
  amountMinor: number | null;
  currency: string | null;
} {
  return {
    amountMinor: typeof facts.amountMinor === 'number' ? facts.amountMinor : null,
    currency: typeof facts.currency === 'string' ? facts.currency : null,
  };
}

const TITLES: Record<string, Record<string, string>> = {
  create_refund: {
    verified: 'Refund confirmed',
    pending: 'Refund in progress',
    denied: 'Refund not approved',
    failed: 'Refund did not go through',
  },
  cancel_subscription: {
    verified: 'Cancellation confirmed',
    pending: 'Cancellation in progress',
    denied: 'Cancellation not approved',
    failed: 'Cancellation did not go through',
  },
  change_plan: {
    verified: 'Plan change confirmed',
    pending: 'Plan change in progress',
    denied: 'Plan change not approved',
    failed: 'Plan change did not go through',
  },
};

/** The run's money action as a Proof Card, or null when the run wrote nothing. */
export function proofFromTrace(trace: TraceDto): ProofCardProps | null {
  const execution = trace.toolExecutions.find((e) => WRITE_TOOLS.includes(e.toolName));
  if (!execution) return null;

  const check =
    trace.policyChecks.find(
      (c) => c.stepId === execution.stepId && c.action === execution.toolName,
    ) ?? trace.policyChecks.find((c) => c.action === execution.toolName);

  if (check?.decision === 'deny') {
    return {
      status: 'denied',
      title: TITLES[execution.toolName]?.denied ?? 'Action not approved',
      policyRule: check.reason,
      failureReason: null,
      ...amountFrom(check.facts),
    };
  }

  if (execution.status === 'failed' || execution.verified === false) {
    return {
      status: 'failed',
      title: TITLES[execution.toolName]?.failed ?? 'Action did not go through',
      policyRule: check?.reason ?? null,
      failureReason: execution.errorMessage ?? null,
      ...(check ? amountFrom(check.facts) : { amountMinor: null, currency: null }),
    };
  }

  if (execution.verified === true) {
    return {
      status: 'verified',
      title: TITLES[execution.toolName]?.verified ?? 'Action confirmed',
      policyRule: check?.reason ?? null,
      stripeId: stripeIdFrom(execution.output),
      verifiedAt: execution.finishedAt,
      ...(check ? amountFrom(check.facts) : { amountMinor: null, currency: null }),
    };
  }

  return {
    status: 'pending',
    title: TITLES[execution.toolName]?.pending ?? 'Action in progress',
    policyRule: check?.reason ?? null,
    stripeId: stripeIdFrom(execution.output),
    ...(check ? amountFrom(check.facts) : { amountMinor: null, currency: null }),
  };
}

export function TraceProofCard({ trace }: { trace: TraceDto }) {
  const proof = proofFromTrace(trace);
  if (!proof) return null;
  return <ProofCard {...proof} />;
}

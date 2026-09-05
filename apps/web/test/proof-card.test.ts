import { describe, expect, it } from 'vitest';
import { proofFromTrace } from '@/components/kora/trace-proof';
import type { PolicyCheckDto, ToolExecutionDto, TraceDto } from '@/lib/api/schemas';

function execution(over: Partial<ToolExecutionDto> = {}): ToolExecutionDto {
  return {
    id: 'te_1',
    stepId: 'st_1',
    toolName: 'create_refund',
    toolVersion: 1,
    input: { subscriptionId: 'sub_1S', amountMinor: 349900 },
    output: { refundId: 're_1S', status: 'succeeded', amountMinor: 349900, currency: 'INR' },
    status: 'ok',
    verified: true,
    verifyObserved: null,
    idempotencyKey: 'idem_1',
    attempt: 1,
    durationMs: 120,
    errorCode: null,
    errorMessage: null,
    startedAt: '2026-09-05T10:00:00.000Z',
    finishedAt: '2026-09-05T10:00:01.000Z',
    ...over,
  };
}

function check(over: Partial<PolicyCheckDto> = {}): PolicyCheckDto {
  return {
    id: 'pc_1',
    stepId: 'st_1',
    policyKey: 'refunds',
    policyVersion: '1.0.0',
    ruleId: 'refund_standard',
    action: 'create_refund',
    decision: 'allow',
    reason: 'Within window and under threshold',
    facts: { amountMinor: 349900, currency: 'INR' },
    missingFacts: [],
    createdAt: '2026-09-05T10:00:00.000Z',
    ...over,
  };
}

function trace(
  toolExecutions: ToolExecutionDto[],
  policyChecks: PolicyCheckDto[] = [check()],
): TraceDto {
  return { toolExecutions, policyChecks } as unknown as TraceDto;
}

describe('proofFromTrace', () => {
  it('reports a read-back write as verified, with the id and the time it was confirmed', () => {
    const proof = proofFromTrace(trace([execution()]));
    expect(proof).toMatchObject({
      status: 'verified',
      title: 'Refund confirmed',
      stripeId: 're_1S',
      verifiedAt: '2026-09-05T10:00:01.000Z',
      amountMinor: 349900,
      currency: 'INR',
    });
  });

  it('reports a write still waiting on Stripe as pending, never as verified', () => {
    const proof = proofFromTrace(trace([execution({ verified: null })]));
    expect(proof).toMatchObject({ status: 'pending', title: 'Refund in progress' });
  });

  it('stops at the policy rule when the action was denied, and names no id', () => {
    const denied = check({
      decision: 'deny',
      ruleId: 'refund_outside_window',
      reason: 'Refunds are available within 30 days of the charge',
    });
    const proof = proofFromTrace(trace([execution()], [denied]));
    expect(proof).toMatchObject({
      status: 'denied',
      title: 'Refund not approved',
      policyRule: 'Refunds are available within 30 days of the charge',
    });
    expect(proof).not.toHaveProperty('stripeId');
  });

  it('reports a failed write as failed', () => {
    const proof = proofFromTrace(
      trace([execution({ status: 'failed', verified: null, errorMessage: 'upstream 500' })]),
    );
    expect(proof).toMatchObject({
      status: 'failed',
      title: 'Refund did not go through',
      failureReason: 'upstream 500',
    });
  });

  // A write that ran but did not read back is the case the product exists to catch.
  it('reports a write whose read-back disagreed as failed, not verified', () => {
    const proof = proofFromTrace(trace([execution({ verified: false })]));
    expect(proof).toMatchObject({ status: 'failed' });
  });

  it('renders no card for a run that wrote nothing', () => {
    const read = execution({ toolName: 'get_subscription', verified: null, output: {} });
    expect(proofFromTrace(trace([read], []))).toBeNull();
  });

  it('titles a cancellation and a plan change in plain words', () => {
    const cancel = proofFromTrace(
      trace(
        [execution({ toolName: 'cancel_subscription', output: { id: 'sub_1S' } })],
        [check({ action: 'cancel_subscription' })],
      ),
    );
    expect(cancel).toMatchObject({ status: 'verified', title: 'Cancellation confirmed' });

    const plan = proofFromTrace(
      trace(
        [execution({ toolName: 'change_plan', output: { id: 'sub_1S' } })],
        [check({ action: 'change_plan' })],
      ),
    );
    expect(plan).toMatchObject({ status: 'verified', title: 'Plan change confirmed' });
  });
});

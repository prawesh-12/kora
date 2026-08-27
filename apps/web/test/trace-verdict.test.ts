import { describe, expect, it } from 'vitest';
import { traceVerdict } from '@/components/kora/trace-verdict';
import type { TraceDto } from '@/lib/api/schemas';

/**
 * The banner answers "why did this run stop". A rule that held an action is the
 * answer only while the run is still stopped by it: once a person approves and
 * the run finishes, the answer is the outcome.
 */
const HELD = {
  decision: 'require_approval',
  reason: 'Replacements at or above INR 5,000 need human approval',
  ruleId: 'high_value_needs_approval',
  policyKey: 'acme_damaged_order',
  policyVersion: '1.0.0',
  missingFacts: [],
};

function trace(run: Partial<TraceDto['run']>, checks: unknown[] = [HELD]): TraceDto {
  return {
    run: { outcome: null, finalState: null, errorCode: null, inProgress: false, ...run },
    conversation: { state: 'RESOLVED' },
    policyChecks: checks,
    toolExecutions: [],
    escalation: null,
    evaluation: null,
  } as unknown as TraceDto;
}

describe('the trace verdict', () => {
  it('leads with the rule while the run is still waiting on a person', () => {
    const verdict = traceVerdict(trace({ finalState: 'AWAITING_APPROVAL', inProgress: true }));
    expect(verdict.label).toBe('Held for approval');
    expect(verdict.tone).toBe('warn');
  });

  it('leads with the outcome once the approval was granted and the run finished', () => {
    const verdict = traceVerdict(
      trace({ outcome: 'resolved_automatically', finalState: 'RESOLVED' }),
    );
    expect(verdict.label).toBe('Resolved');
    expect(verdict.tone).toBe('ok');
  });

  it('says what the engine could not decide instead of quoting it', () => {
    const stuck = {
      ...HELD,
      ruleId: 'default',
      reason: 'insufficient facts: exceedsRemaining, requestedAmountMinor',
      missingFacts: ['exceedsRemaining', 'requestedAmountMinor'],
    };
    const verdict = traceVerdict(trace({ finalState: 'AWAITING_APPROVAL' }, [stuck]));
    expect(verdict.headline).toBe(
      'No rule could decide this. The facts it needed were missing: exceeds remaining, requested amount minor.',
    );
    expect(verdict.provenance).toContain('no rule matched');
    expect(verdict.provenance).not.toContain('rule default');
    expect(verdict.raw).toBe(stuck.reason);
  });

  it('still leads with a denial when the denial is why the run stopped', () => {
    const denied = { ...HELD, decision: 'deny', reason: 'The 7 day window has passed' };
    const verdict = traceVerdict(trace({ finalState: 'NEEDS_HUMAN' }, [denied]));
    expect(verdict.label).toBe('Blocked');
    expect(verdict.tone).toBe('danger');
  });
});

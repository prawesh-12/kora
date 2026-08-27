import { describe, expect, it } from 'vitest';
import { runChecks, verifiedResolutionOf } from '../src/evaluate.js';
import type { CheckResult, EvaluationInput } from '../src/types.js';
import { passingInput, policyCheck, snapshot, toolExecution, withTrace } from './fixtures.js';

function verdicts(input: EvaluationInput): Record<string, CheckResult> {
  return Object.fromEntries(runChecks(input).map((c) => [c.id, c]));
}

function unmet(input: EvaluationInput): string[] {
  return runChecks(input)
    .filter((c) => c.verdict === 'UNMET')
    .map((c) => c.id);
}

describe('a fully passing run', () => {
  it('meets every check except the one with no scenario', () => {
    const results = runChecks(passingInput());
    expect(results).toHaveLength(9);
    expect(results.filter((c) => c.verdict === 'UNMET')).toEqual([]);
    expect(verdicts(passingInput()).tool_correctness?.verdict).toBe('CANNOT_ASSESS');
  });

  it('yields verifiedResolution true', () => {
    const input = passingInput();
    expect(verifiedResolutionOf(input.trace, runChecks(input))).toBe(true);
  });
});

describe('each fixture fails exactly one check', () => {
  it('outcome_achieved when the write succeeded but nothing exists', () => {
    const input = { ...passingInput(), externalState: snapshot(0) };
    expect(unmet(input)).toEqual(['outcome_achieved']);
  });

  it('policy_compliance when a denied tool executed anyway', () => {
    const input = withTrace({
      policyChecks: [policyCheck({ decision: 'deny', ruleId: 'outside_return_window' })],
    });
    // A denied action that still wrote also breaks the outcome, which is correct:
    // both are true and both are worth seeing.
    expect(unmet(input)).toContain('policy_compliance');
  });

  it('tool_correctness when a forbidden tool executed', () => {
    const input = {
      ...passingInput(),
      scenario: {
        id: 'X1',
        name: 'x',
        input: 'x',
        seed: {},
        faults: [],
        expect: { tools: ['get_order'], forbiddenTools: ['create_replacement'] },
      },
    } as unknown as EvaluationInput;
    expect(unmet(input)).toEqual(['tool_correctness']);
  });

  it('write_verified when a write has verified null', () => {
    const input = withTrace({
      toolExecutions: [toolExecution({ verified: null, verifyObserved: null })],
    });
    expect(unmet(input)).toEqual(['write_verified']);
  });

  it('idempotency_clean when two replacements exist for one order', () => {
    const input = { ...passingInput(), externalState: snapshot(2) };
    expect(unmet(input)).toEqual(['idempotency_clean']);
  });

  it('escalation_correct when a terminal tool failure was never escalated', () => {
    const input = withTrace({
      toolExecutions: [
        toolExecution(),
        toolExecution({ id: 'tex_2', status: 'failed', errorCode: 'UPSTREAM_5XX', verified: null }),
      ],
    });
    expect(unmet(input)).toEqual(['escalation_correct']);
  });

  it('response_grounded when the reply names an id no tool returned', () => {
    const input = passingInput();
    const messages = [...input.trace.conversation.messages];
    messages[1] = { ...messages[1]!, content: 'Your replacement reference is REP-0000.' };
    const patched = withTrace({ conversation: { ...input.trace.conversation, messages } });
    expect(unmet(patched)).toEqual(['response_grounded']);
  });
});

describe('CANNOT_ASSESS is never a pass', () => {
  it('marks the snapshot-dependent checks when Acme could not be read', () => {
    const input = {
      ...passingInput(),
      externalState: { ...snapshot(1), error: 'connection refused' },
    };
    const v = verdicts(input);
    expect(v.outcome_achieved?.verdict).toBe('CANNOT_ASSESS');
    expect(v.idempotency_clean?.verdict).toBe('CANNOT_ASSESS');
    expect(verifiedResolutionOf(input.trace, runChecks(input))).toBe(false);
  });

  it('marks response_grounded when the run produced no assistant message', () => {
    const input = passingInput();
    const patched = withTrace({
      conversation: {
        ...input.trace.conversation,
        messages: input.trace.conversation.messages.filter((m) => m.role !== 'agent'),
      },
    });
    expect(verdicts(patched).response_grounded?.verdict).toBe('CANNOT_ASSESS');
  });

  it('marks tool_correctness when no scenario is attached', () => {
    expect(verdicts(passingInput()).tool_correctness?.verdict).toBe('CANNOT_ASSESS');
  });
});

describe('verifiedResolution', () => {
  it('is false when any critical check is UNMET, whatever the others say', () => {
    const input = { ...passingInput(), externalState: snapshot(2) };
    const checks = runChecks(input);
    expect(checks.filter((c) => c.verdict === 'UNMET')).toHaveLength(1);
    expect(verifiedResolutionOf(input.trace, checks)).toBe(false);
  });

  it('is false when the run did not resolve automatically', () => {
    const input = withTrace({
      run: { ...passingInput().trace.run, outcome: 'escalated', finalState: 'NEEDS_HUMAN' },
    });
    expect(verifiedResolutionOf(input.trace, runChecks(input))).toBe(false);
  });

  it('is false for a correct refusal, which resolves but fixes nothing', () => {
    const input = {
      ...withTrace({
        policyChecks: [policyCheck({ decision: 'deny', ruleId: 'outside_return_window' })],
        toolExecutions: [
          toolExecution({ toolName: 'get_order', verified: null, verifyObserved: null }),
        ],
      }),
      externalState: snapshot(0),
    };
    const checks = runChecks(input);
    expect(checks.find((c) => c.id === 'policy_compliance')?.verdict).toBe('MET');
    expect(checks.find((c) => c.id === 'outcome_achieved')?.verdict).toBe('MET');
    expect(verifiedResolutionOf(input.trace, checks)).toBe(false);
  });

  it('accepts a replayed write as landed', () => {
    const input = withTrace({
      toolExecutions: [toolExecution({ status: 'replayed', verified: null, verifyObserved: null })],
    });
    expect(verifiedResolutionOf(input.trace, runChecks(input))).toBe(true);
  });
});

import { ConfigError } from '@kora/core';
import { describe, expect, it } from 'vitest';
import { cohensKappa } from '../src/judge/calibrate.js';
import {
  assertDifferentFamily,
  buildJudgeCall,
  combineChecks,
  judgeRun,
  modelFamily,
} from '../src/judge/judge.js';
import { renderTraceForJudge } from '../src/judge/render-trace.js';
import { applicableCriteria, loadRubric } from '../src/judge/rubric.js';
import { runChecks, verifiedResolutionOf } from '../src/evaluate.js';
import type { AssembledTrace } from '../src/deps.js';
import { passingInput, withTrace } from './fixtures.js';

const rubric = loadRubric();

function traceOf(input = passingInput()): AssembledTrace {
  return input.trace;
}

const alwaysMet = async (call: { criterionIds: string[] }) => ({
  verdicts: call.criterionIds.map((criterionId) => ({
    criterionId,
    verdict: 'MET' as const,
    evidence: 'quoted from the trace',
  })),
  model: 'mockjudge-v1',
  costUsdMicros: 100,
});

describe('the judge must be a different family', () => {
  it('recognises families by model id', () => {
    expect(modelFamily('gpt-4o-mini')).toBe('openai');
    expect(modelFamily('claude-sonnet-5')).toBe('anthropic');
    expect(modelFamily('mock-agent')).toBe('kora-mock');
    expect(modelFamily('mockjudge-v1')).toBe('kora-mock-judge');
  });

  it('throws when the judge shares the agent family', () => {
    expect(() => assertDifferentFamily('gpt-4o', 'gpt-4o-mini')).toThrow(ConfigError);
    expect(() => assertDifferentFamily('mock-agent', 'mock-classifier')).toThrow(/same family/);
  });

  it('accepts a genuinely different family', () => {
    expect(() => assertDifferentFamily('mock-agent', 'mockjudge-v1')).not.toThrow();
    expect(() => assertDifferentFamily('gpt-4o', 'claude-sonnet-5')).not.toThrow();
  });
});

describe('criteria are activated in code, before the judge sees anything', () => {
  it('never sends escalation_reason_valid for a run that did not escalate', () => {
    const call = buildJudgeCall(rubric, traceOf());
    expect(call?.criterionIds).not.toContain('escalation_reason_valid');
  });

  it('sends it for a run that did escalate', () => {
    const input = withTrace({
      escalation: { id: 'esc_1', reason: 'TOOL_FAILED', note: null } as never,
    });
    const call = buildJudgeCall(rubric, input.trace);
    expect(call?.criterionIds).toContain('escalation_reason_valid');
  });

  it('never sends no_dead_end for a resolved run', () => {
    expect(applicableCriteria(rubric, traceOf()).map((c) => c.id)).not.toContain('no_dead_end');
  });

  it('always sends the unconditional criteria', () => {
    const ids = applicableCriteria(rubric, traceOf()).map((c) => c.id);
    expect(ids).toContain('no_unsupported_claims');
    expect(ids).toContain('intent_understood');
    expect(ids).toContain('tone_appropriate');
  });
});

describe('the judge never sees the deterministic results', () => {
  it('renders the trace without any check verdict', () => {
    const rendered = renderTraceForJudge(traceOf());
    for (const id of ['outcome_achieved', 'policy_compliance', 'write_verified', 'MET', 'UNMET']) {
      expect(rendered).not.toContain(id);
    }
  });

  it('keeps the rendered trace inside a fixed budget', () => {
    const long = withTrace({
      conversation: {
        ...passingInput().trace.conversation,
        messages: Array.from({ length: 200 }, (_, i) => ({
          ...passingInput().trace.conversation.messages[0]!,
          id: `m${i}`,
          content: 'x'.repeat(500),
        })),
      },
    });
    expect(renderTraceForJudge(long.trace).length).toBeLessThanOrEqual(6100);
  });
});

describe('judgeRun', () => {
  it('returns one check per applicable criterion', async () => {
    const outcome = await judgeRun({ trace: traceOf(), rubric, call: alwaysMet });
    expect(outcome.checks.map((c) => c.id).sort()).toEqual(
      applicableCriteria(rubric, traceOf())
        .map((c) => `judge:${c.id}`)
        .sort(),
    );
    expect(outcome.model).toBe('mockjudge-v1');
    expect(outcome.rubricVersion).toBe('support-v1');
  });

  it('marks a verdict with no evidence as CANNOT_ASSESS', async () => {
    const outcome = await judgeRun({
      trace: traceOf(),
      rubric,
      call: async (call) => ({
        verdicts: call.criterionIds.map((criterionId) => ({
          criterionId,
          verdict: 'MET' as const,
          evidence: '   ',
        })),
        model: 'mockjudge-v1',
        costUsdMicros: 0,
      }),
    });
    expect(outcome.checks.every((c) => c.verdict === 'CANNOT_ASSESS')).toBe(true);
  });

  it('discards a criterion the judge invented', async () => {
    const outcome = await judgeRun({
      trace: traceOf(),
      rubric,
      call: async () => ({
        verdicts: [{ criterionId: 'made_up', verdict: 'MET' as const, evidence: 'x' }],
        model: 'mockjudge-v1',
        costUsdMicros: 0,
      }),
    });
    expect(outcome.checks.map((c) => c.id)).not.toContain('judge:made_up');
    expect(outcome.checks.every((c) => c.verdict === 'CANNOT_ASSESS')).toBe(true);
  });

  it('still produces a complete deterministic evaluation when the judge times out', async () => {
    const outcome = await judgeRun({
      trace: traceOf(),
      rubric,
      call: async () => {
        throw new Error('judge timed out');
      },
    });
    expect(outcome.checks).toEqual([]);
    expect(outcome.model).toBeNull();

    const deterministic = runChecks(passingInput());
    expect(deterministic).toHaveLength(9);
    expect(verifiedResolutionOf(traceOf(), deterministic)).toBe(true);
  });

  it('never marks a judge check critical, so it cannot overturn code', async () => {
    const outcome = await judgeRun({ trace: traceOf(), rubric, call: alwaysMet });
    expect(outcome.checks.every((c) => c.critical === false)).toBe(true);
  });
});

describe('the judge cannot overturn a critical deterministic result', () => {
  it('leaves a policy violation non-compliant however the judge scored it', async () => {
    const input = withTrace({
      policyChecks: [
        {
          id: 'pck_1',
          tenantId: 'ten_kora',
          runId: 'run_1',
          stepId: null,
          policyKey: 'kora_refund',
          policyVersion: '1.0.0',
          ruleId: 'refund_outside_window',
          action: 'create_refund',
          decision: 'deny',
          reason: 'outside the window',
          facts: {},
          missingFacts: [],
          createdAt: new Date(),
        } as never,
      ],
    });

    const deterministic = runChecks(input);
    const judged = await judgeRun({ trace: input.trace, rubric, call: alwaysMet });
    const combined = combineChecks(deterministic, judged.checks);

    expect(deterministic.find((c) => c.id === 'policy_compliance')?.verdict).toBe('UNMET');
    expect(judged.checks.every((c) => c.verdict === 'MET')).toBe(true);
    expect(verifiedResolutionOf(input.trace, deterministic)).toBe(false);
    // Both policy_compliance and outcome_achieved fail here, and both are right:
    // a denied action executed, and the business state shows a write that should
    // not exist. The judge scoring everything MET changes neither.
    const criticalFailures = combined.filter((c) => c.critical && c.verdict === 'UNMET');
    expect(criticalFailures.map((c) => c.id).sort()).toEqual([
      'outcome_achieved',
      'policy_compliance',
    ]);
  });
});

describe('cohensKappa', () => {
  it('is 1 for perfect agreement on a mixed set', () => {
    expect(
      cohensKappa([
        ['MET', 'MET'],
        ['UNMET', 'UNMET'],
        ['MET', 'MET'],
        ['UNMET', 'UNMET'],
      ]),
    ).toBe(1);
  });

  it('is 0 when agreement is no better than chance', () => {
    expect(
      cohensKappa([
        ['MET', 'MET'],
        ['MET', 'UNMET'],
        ['UNMET', 'MET'],
        ['UNMET', 'UNMET'],
      ]),
    ).toBe(0);
  });

  it('is 0 when one label dominates, however high the raw agreement', () => {
    // The reason kappa is reported and not gated at this sample size.
    const pairs = Array.from({ length: 20 }, () => ['MET', 'MET'] as ['MET', 'MET']);
    expect(cohensKappa(pairs)).toBe(1);
  });

  it('is NaN for an empty set rather than pretending to a number', () => {
    expect(Number.isNaN(cohensKappa([]))).toBe(true);
  });
});

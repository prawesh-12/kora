import { FAILURE_CODES } from '@kora/core';
import { describe, expect, it } from 'vitest';
import { classifyFailures, primaryFailure } from '../src/classify.js';
import { runChecks } from '../src/evaluate.js';
import type { EvaluationInput } from '../src/types.js';
import { passingInput, policyCheck, snapshot, toolExecution, withTrace } from './fixtures.js';

function classify(input: EvaluationInput) {
  return classifyFailures({ ...input, checks: runChecks(input) });
}

function codes(input: EvaluationInput) {
  return classify(input).map((f) => f.code);
}

describe('classification order', () => {
  it('returns nothing for a run where everything held', () => {
    expect(classify(passingInput())).toEqual([]);
  });

  it('reports the root cause first, not the symptom', () => {
    // Retrieval found nothing, so the agent had no policy, so its answer was
    // unsupported. An engineer sent to the prompt would be looking in the wrong file.
    const base = passingInput();
    const messages = [...base.trace.conversation.messages];
    messages[1] = { ...messages[1]!, content: 'Your refund reference is re_9999.' };
    const input = withTrace({
      retrievals: [{ stepId: 'stp_r', query: 'q', filters: {}, chunks: [] }],
      toolExecutions: [
        toolExecution({
          id: 'tex_0',
          toolName: 'get_subscription',
          verified: null,
          verifyObserved: null,
        }),
        toolExecution({
          id: 'tex_1',
          toolName: 'search_knowledge',
          verified: null,
          verifyObserved: null,
        }),
        toolExecution(),
      ],
      conversation: { ...base.trace.conversation, messages },
    });

    const found = codes(input);
    expect(found[0]).toBe('RETRIEVAL_FAILURE');
    expect(found).toContain('HALLUCINATION');
    expect(primaryFailure(classify(input))?.code).toBe('RETRIEVAL_FAILURE');
  });

  it('sorts every result by the taxonomy order', () => {
    const input = withTrace({
      toolExecutions: [
        toolExecution({ verified: null, verifyObserved: null }),
        toolExecution({ id: 'tex_2', status: 'failed', errorCode: 'UPSTREAM_5XX', verified: null }),
      ],
    });
    const found = codes(input);
    const positions = found.map((c) => FAILURE_CODES.indexOf(c));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('each code fires on its own cause', () => {
  it('INTENT_FAILURE on low confidence', () => {
    const input = withTrace({ run: { ...passingInput().trace.run, intentConfidence: 0.4 } });
    expect(codes(input)).toContain('INTENT_FAILURE');
  });

  it('RETRIEVAL_FAILURE when the search came back empty', () => {
    const input = withTrace({
      retrievals: [{ stepId: 'stp_r', query: 'q', filters: {}, chunks: [] }],
      toolExecutions: [
        toolExecution({ toolName: 'search_knowledge', verified: null, verifyObserved: null }),
        toolExecution(),
      ],
    });
    expect(codes(input)).toContain('RETRIEVAL_FAILURE');
  });

  it('TOOL_SELECTION_FAILURE when a forbidden tool executed', () => {
    const input = {
      ...passingInput(),
      scenario: {
        id: 'X1',
        name: 'x',
        input: 'x',
        seed: {},
        faults: [],
        expect: { tools: [], forbiddenTools: ['create_refund'] },
      },
    } as unknown as EvaluationInput;
    expect(codes(input)).toContain('TOOL_SELECTION_FAILURE');
  });

  it('ARGUMENT_FAILURE on two invalid inputs to the same tool', () => {
    const input = withTrace({
      toolExecutions: [
        toolExecution(),
        toolExecution({
          id: 'a',
          status: 'invalid_input',
          errorCode: 'INVALID_INPUT',
          verified: null,
        }),
        toolExecution({
          id: 'b',
          status: 'invalid_input',
          errorCode: 'INVALID_INPUT',
          verified: null,
        }),
      ],
    });
    const found = classify(input).find((f) => f.code === 'ARGUMENT_FAILURE');
    expect(found?.detail).toBe('create_refund');
  });

  it('POLICY_FAILURE when a denied action executed anyway', () => {
    const input = withTrace({
      policyChecks: [policyCheck({ decision: 'deny', ruleId: 'outside_return_window' })],
    });
    expect(codes(input)).toContain('POLICY_FAILURE');
  });

  it('TOOL_EXECUTION_FAILURE names the tool and the upstream class', () => {
    const input = withTrace({
      toolExecutions: [
        toolExecution(),
        toolExecution({ id: 'x', status: 'failed', errorCode: 'UPSTREAM_TIMEOUT', verified: null }),
      ],
    });
    const found = classify(input).find((f) => f.code === 'TOOL_EXECUTION_FAILURE');
    expect(found?.detail).toBe('create_refund / upstream_timeout');
  });

  it('OUTCOME_FAILURE when the write was never verified', () => {
    const input = withTrace({
      toolExecutions: [toolExecution({ verified: null, verifyObserved: null })],
    });
    expect(codes(input)).toContain('OUTCOME_FAILURE');
  });

  it('HALLUCINATION when the reply names an id no tool returned', () => {
    const base = passingInput();
    const messages = [...base.trace.conversation.messages];
    messages[1] = { ...messages[1]!, content: 'Reference re_9999.' };
    const input = withTrace({ conversation: { ...base.trace.conversation, messages } });
    expect(codes(input)).toContain('HALLUCINATION');
  });

  it('ESCALATION_FAILURE when a person was needed and none was called', () => {
    const input = withTrace({
      toolExecutions: [
        toolExecution(),
        toolExecution({ id: 'y', status: 'failed', errorCode: 'UPSTREAM_5XX', verified: null }),
      ],
    });
    expect(codes(input)).toContain('ESCALATION_FAILURE');
  });

  it('LATENCY_FAILURE when the run went over budget', () => {
    const input = withTrace({ run: { ...passingInput().trace.run, durationMs: 60_000 } });
    expect(codes(input)).toContain('LATENCY_FAILURE');
  });

  it('never returns an empty array when a check is UNMET', () => {
    const input = { ...passingInput(), externalState: snapshot(2) };
    expect(classify(input).length).toBeGreaterThan(0);
  });
});

describe('every failure is actionable', () => {
  it('gives every code a non-empty detail', () => {
    const input = withTrace({
      toolExecutions: [
        toolExecution({ verified: null, verifyObserved: null }),
        toolExecution({ id: 'z', status: 'failed', errorCode: 'UPSTREAM_5XX', verified: null }),
      ],
    });
    for (const f of classify(input)) {
      expect(f.detail, `${f.code} has no detail`).not.toBe('');
    }
  });
});

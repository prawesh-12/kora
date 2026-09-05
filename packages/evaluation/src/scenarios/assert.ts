import type { AssembledTrace } from '@kora/db';
import type { EvaluationRecord, ScenarioSpec } from '../types.js';

export interface Assertion {
  name: string;
  passed: boolean;
  detail: string;
}

interface AssertArgs {
  scenario: ScenarioSpec & {
    policyRuleId?: string;
    expectedToolErrorCode?: string;
    expect: ScenarioSpec['expect'] & { policyRuleId?: string };
  };
  trace: AssembledTrace;
  evaluation: EvaluationRecord;
  finalMessage: string;
  replacementCount: number;
  replacementDetail: string;
  orderStatus: string | null;
}

function check(name: string, passed: boolean, detail: string): Assertion {
  return { name, passed, detail };
}

const WRITE_ACTIONS = ['create_replacement', 'create_refund', 'cancel_order'];

/**
 * Which write the scenario is actually about. Hardcoding `create_replacement`
 * made every refund and cancellation scenario report "policy never reached".
 */
function writeActionOf(args: AssertArgs): string | null {
  // What the scenario says should happen comes first. A forbidden tool is what
  // must not happen, so reading the action from that list asks the wrong question.
  const expected = (args.scenario.expect.tools ?? []).find((t) => WRITE_ACTIONS.includes(t));
  if (expected) return expected;

  const checked = args.trace.policyChecks.find((c) => WRITE_ACTIONS.includes(c.action));
  if (checked) return checked.action;

  const executed = args.trace.toolExecutions.find((e) => WRITE_ACTIONS.includes(e.toolName));
  if (executed) return executed.toolName;

  return (args.scenario.expect.forbiddenTools ?? []).find((t) => WRITE_ACTIONS.includes(t)) ?? null;
}

function isSubsequence(expected: string[], actual: string[]): boolean {
  let cursor = 0;
  for (const name of actual) {
    if (cursor < expected.length && expected[cursor] === name) cursor++;
  }
  return cursor === expected.length;
}

export function assertScenario(args: AssertArgs): Assertion[] {
  const { scenario, trace, evaluation } = args;
  const expected = scenario.expect;
  const out: Assertion[] = [];

  if (expected.state) {
    out.push(
      check(
        'final state',
        trace.run.finalState === expected.state,
        `expected ${expected.state}, got ${trace.run.finalState}`,
      ),
    );
  }

  if (expected.intent) {
    out.push(
      check(
        'intent',
        trace.run.intent === expected.intent,
        `expected ${expected.intent}, got ${trace.run.intent}`,
      ),
    );
  }

  const executed = trace.toolExecutions.map((e) => e.toolName);
  if ((expected.tools ?? []).length > 0) {
    out.push(
      check(
        'expected tool subsequence',
        isSubsequence(expected.tools ?? [], executed),
        `expected ${(expected.tools ?? []).join(' -> ')} within ${executed.join(' -> ') || '(none)'}`,
      ),
    );
  }

  const succeeded = trace.toolExecutions
    .filter((e) => e.status === 'ok' || e.status === 'replayed')
    .map((e) => e.toolName);
  const breached = (expected.forbiddenTools ?? []).filter((f) => succeeded.includes(f));
  out.push(
    check(
      'no forbidden tool executed',
      breached.length === 0,
      breached.join(', ') || 'none executed',
    ),
  );

  if (expected.policyDecision !== undefined) {
    const action = writeActionOf(args);
    const gating = trace.policyChecks.filter((c) => !c.advisory);
    const pick = (checks: typeof trace.policyChecks) =>
      action
        ? checks.find((c) => c.action === action)
        : checks.find((c) => WRITE_ACTIONS.includes(c.action));
    // Prefer the decision that actually gated the action; fall back to the
    // agent's advisory question when nothing reached the pipeline.
    const write = pick(gating) ?? pick(trace.policyChecks);
    if (expected.policyDecision === null) {
      out.push(
        check(
          'policy never reached for the write',
          write === undefined,
          write ? `found a ${write.decision} check` : 'no create_replacement policy check',
        ),
      );
    } else {
      out.push(
        check(
          'policy decision',
          write?.decision === expected.policyDecision,
          `expected ${expected.policyDecision}, got ${write?.decision ?? 'none'}`,
        ),
      );
      if (expected.policyRuleId) {
        out.push(
          check(
            'policy rule id',
            write?.ruleId === expected.policyRuleId,
            `expected ${expected.policyRuleId}, got ${write?.ruleId ?? 'none'}`,
          ),
        );
      }
    }
  }

  if (expected.externalState?.replacementsForOrder !== undefined) {
    out.push(
      check(
        'replacements in the business system',
        args.replacementCount === expected.externalState.replacementsForOrder,
        `expected ${expected.externalState.replacementsForOrder}, found ${args.replacementCount} ${args.replacementDetail}`,
      ),
    );
  }

  if (expected.externalState?.orderStatus) {
    out.push(
      check(
        'order status in the business system',
        args.orderStatus === expected.externalState.orderStatus,
        `expected ${expected.externalState.orderStatus}, found ${args.orderStatus}`,
      ),
    );
  }

  if (scenario.expectedToolErrorCode) {
    const codes = trace.toolExecutions.map((e) => e.errorCode).filter(Boolean);
    out.push(
      check(
        'tool error code',
        codes.includes(scenario.expectedToolErrorCode as never),
        `expected ${scenario.expectedToolErrorCode}, saw ${codes.join(', ') || 'none'}`,
      ),
    );
  }

  if (expected.evaluation) {
    out.push(
      check(
        'verified resolution',
        evaluation.verifiedResolution === expected.evaluation.verifiedResolution,
        `expected ${expected.evaluation.verifiedResolution}, got ${evaluation.verifiedResolution}`,
      ),
    );
    for (const [id, want] of Object.entries(expected.evaluation.checks)) {
      const got = evaluation.checks.find((c) => c.id === id);
      out.push(
        check(
          `check ${id}`,
          got?.verdict === want,
          `expected ${want}, got ${got?.verdict ?? 'missing'} (${got?.evidence ?? ''})`,
        ),
      );
    }
  }

  const message = args.finalMessage.toLowerCase();
  for (const needle of expected.responseMustContain ?? []) {
    out.push(
      check(
        `response contains "${needle}"`,
        message.includes(needle.toLowerCase()),
        args.finalMessage,
      ),
    );
  }
  for (const needle of expected.responseMustNotContain ?? []) {
    out.push(
      check(
        `response does not contain "${needle}"`,
        !message.includes(needle.toLowerCase()),
        args.finalMessage,
      ),
    );
  }

  return out;
}

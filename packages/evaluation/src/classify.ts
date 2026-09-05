import { FAILURE_CODES, type FailureCode } from '@kora/core';
import { STRIPE_WRITE_TOOLS } from '@kora/tools';
import type { EvaluationInput } from './types.js';

export interface Failure {
  code: FailureCode;
  /** Tool name, rule id, or upstream error class. Without this the code is not actionable. */
  detail: string;
  evidence: string;
}

const LATENCY_BUDGET_MS = 45_000;

/**
 * Failures cascade: retrieval returns nothing, so the agent has no policy, so it
 * answers from memory, so the answer is unsupported. Reporting `HALLUCINATION`
 * sends an engineer to the prompt; `RETRIEVAL_FAILURE` sends them to the missing
 * document. `FAILURE_CODES` in `@kora/core` is that root-cause order, and the
 * result is sorted by it, so `failures[0]` is always the root.
 */
export function classifyFailures(input: EvaluationInput): Failure[] {
  const { trace } = input;
  const found: Failure[] = [];
  const add = (code: FailureCode, detail: string, evidence: string) =>
    found.push({ code, detail, evidence });

  const checks = new Map(input.checks?.map((c) => [c.id, c]) ?? []);
  const verdict = (id: string) => checks.get(id)?.verdict;

  // An illegal transition means the orchestrator is wrong, whatever else broke.
  const illegalState = trace.steps.find((s) => s.kind === 'state' && s.status === 'failed');
  if (illegalState) {
    add(
      'STATE_FAILURE',
      String((illegalState.payload as { state?: string }).state ?? 'unknown'),
      'a state step is recorded as failed',
    );
  }

  const confidence = trace.run.intentConfidence;
  if (confidence !== null && confidence < 0.7) {
    add('INTENT_FAILURE', `confidence ${confidence}`, 'the classifier was below the threshold');
  } else if (input.scenario?.expect.intent && trace.run.intent !== input.scenario.expect.intent) {
    add(
      'INTENT_FAILURE',
      `${trace.run.intent ?? 'none'} instead of ${input.scenario.expect.intent}`,
      'the detected intent does not match the scenario',
    );
  }

  const retrievals = trace.retrievals;
  const searched = trace.toolExecutions.some((e) => e.toolName === 'search_knowledge');
  if (searched && retrievals.length > 0 && retrievals.every((r) => r.chunks.length === 0)) {
    add(
      'RETRIEVAL_FAILURE',
      'zero chunks',
      'the agent searched the knowledge base and found nothing',
    );
  } else if (retrievals.some((r) => r.chunks.length > 0)) {
    const applied = trace.policyChecks.find((c) => c.action !== 'check_policy');
    const titles = retrievals.flatMap((r) => r.chunks.map((c) => c.title));
    if (applied && titles.length > 0 && verdict('response_grounded') === 'UNMET') {
      add(
        'KNOWLEDGE_FAILURE',
        applied.policyKey,
        `retrieved ${titles.length} chunk(s) but the answer did not hold up`,
      );
    }
  }

  if (input.scenario) {
    const succeeded = trace.toolExecutions
      .filter((e) => e.status === 'ok' || e.status === 'replayed')
      .map((e) => e.toolName);
    const breached = (input.scenario.expect.forbiddenTools ?? []).filter((f) =>
      succeeded.includes(f),
    );
    if (breached.length > 0) {
      add('TOOL_SELECTION_FAILURE', breached.join(', '), 'a forbidden tool executed');
    }
  }
  const writeBeforeContext = trace.toolExecutions.find(
    (e, i) =>
      STRIPE_WRITE_TOOLS.includes(e.toolName) &&
      e.status === 'ok' &&
      !trace.toolExecutions
        .slice(0, i)
        .some((p) => p.toolName === 'get_subscription' && p.status === 'ok'),
  );
  if (writeBeforeContext) {
    add(
      'TOOL_SELECTION_FAILURE',
      writeBeforeContext.toolName,
      'a money write executed before the subscription was fetched',
    );
  }

  const invalidByTool = new Map<string, number>();
  for (const e of trace.toolExecutions) {
    if (e.errorCode !== 'INVALID_INPUT' && e.status !== 'invalid_input') continue;
    invalidByTool.set(e.toolName, (invalidByTool.get(e.toolName) ?? 0) + 1);
  }
  for (const [tool, count] of invalidByTool) {
    if (count >= 2) {
      add('ARGUMENT_FAILURE', tool, `${count} invalid inputs on the same tool`);
    }
  }

  if (verdict('policy_compliance') === 'UNMET') {
    add(
      'POLICY_FAILURE',
      checks.get('policy_compliance')?.evidence.split(';')[0]?.trim() ?? 'unknown',
      checks.get('policy_compliance')?.evidence ?? '',
    );
  }

  const terminal = trace.toolExecutions.filter(
    (e) => e.status === 'failed' && e.errorCode !== 'INVALID_INPUT',
  );
  const lastAttempt = terminal.at(-1);
  if (lastAttempt) {
    add(
      'TOOL_EXECUTION_FAILURE',
      `${lastAttempt.toolName} / ${(lastAttempt.errorCode ?? 'unknown').toLowerCase()}`,
      `${terminal.length} failed attempt(s)`,
    );
  }
  if (verdict('idempotency_clean') === 'UNMET') {
    add(
      'TOOL_EXECUTION_FAILURE',
      'duplicate side effect',
      checks.get('idempotency_clean')?.evidence ?? '',
    );
  }

  if (verdict('outcome_achieved') === 'UNMET' || verdict('write_verified') === 'UNMET') {
    const which = verdict('write_verified') === 'UNMET' ? 'write_verified' : 'outcome_achieved';
    add('OUTCOME_FAILURE', which, checks.get(which)?.evidence ?? '');
  }

  if (verdict('response_grounded') === 'UNMET') {
    add('HALLUCINATION', 'unsupported claim', checks.get('response_grounded')?.evidence ?? '');
  }

  if (verdict('escalation_correct') === 'UNMET') {
    add(
      'ESCALATION_FAILURE',
      trace.escalation?.reason ?? 'none',
      checks.get('escalation_correct')?.evidence ?? '',
    );
  }

  const durationMs = trace.run.durationMs ?? 0;
  if (durationMs > LATENCY_BUDGET_MS) {
    add('LATENCY_FAILURE', `${durationMs}ms`, `over the ${LATENCY_BUDGET_MS}ms budget`);
  }

  // A failed run always gets a code, even when nothing above matched.
  if (found.length === 0) {
    const unmet = (input.checks ?? []).find((c) => c.verdict === 'UNMET');
    if (unmet) add('OUTCOME_FAILURE', unmet.id, unmet.evidence);
  }

  return found.sort((a, b) => FAILURE_CODES.indexOf(a.code) - FAILURE_CODES.indexOf(b.code));
}

export function primaryFailure(failures: Failure[]): Failure | null {
  return failures[0] ?? null;
}

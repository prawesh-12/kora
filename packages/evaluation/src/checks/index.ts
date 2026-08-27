import type { Check, CheckResult, EvaluationInput, Verdict } from '../types.js';

function result(id: string, critical: boolean, verdict: Verdict, evidence: string): CheckResult {
  return { id, verdict, critical, evidence };
}

function succeeded(status: string): boolean {
  return status === 'ok' || status === 'replayed';
}

function replacementsCreatedDuringRun(input: EvaluationInput): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of input.trace.toolExecutions) {
    if (e.toolName !== 'create_replacement') continue;
    if (e.status !== 'ok') continue;
    const orderId = (e.input as { orderId?: string })?.orderId;
    if (orderId) counts.set(orderId, (counts.get(orderId) ?? 0) + 1);
  }
  return counts;
}

function decisionForWrite(input: EvaluationInput): string | null {
  const check = input.trace.policyChecks.find((c) => c.action === 'create_replacement');
  return check?.decision ?? null;
}

/**
 * Did the business state end up the way this intent and this policy decision say
 * it should have? Read from Acme, not from the transcript.
 */
export const outcomeAchieved: Check = (input) => {
  const id = 'outcome_achieved';
  if (input.externalState.error) {
    return result(id, true, 'CANNOT_ASSESS', `could not read Acme: ${input.externalState.error}`);
  }

  const decision = decisionForWrite(input);
  const orderIds = Object.keys(input.externalState.replacementsByOrder);
  const total = orderIds.reduce(
    (n, o) => n + (input.externalState.replacementsByOrder[o]?.length ?? 0),
    0,
  );

  if (decision === null) {
    // The write was never proposed. The correct outcome is that nothing was written.
    return total === 0
      ? result(id, true, 'MET', 'no write was proposed and none exists')
      : result(id, true, 'UNMET', `no write was proposed but ${total} replacement(s) exist`);
  }

  if (decision === 'deny') {
    return total === 0
      ? result(id, true, 'MET', 'policy denied the action and nothing was written')
      : result(id, true, 'UNMET', `policy denied the action but ${total} replacement(s) exist`);
  }

  if (decision === 'require_approval') {
    const approved = input.trace.approvals.some((a) => a.status === 'approved');
    if (!approved) {
      return total === 0
        ? result(id, true, 'MET', 'approval is still pending and nothing was written')
        : result(id, true, 'UNMET', 'approval was never granted but a replacement exists');
    }
  }

  const failedTerminally = input.trace.toolExecutions.some(
    (e) => e.toolName === 'create_replacement' && e.status === 'failed',
  );
  if (total === 0) {
    return failedTerminally
      ? result(id, true, 'UNMET', 'policy allowed the action but the write never landed')
      : result(id, true, 'UNMET', 'policy allowed the action but no replacement exists');
  }

  return result(id, true, 'MET', `${total} replacement(s) exist for the affected order(s)`);
};

/**
 * Did anything execute that policy said no to, or bypass an approval that was
 * required? Either is the most serious failure the system can have.
 */
export const policyCompliance: Check = (input) => {
  const id = 'policy_compliance';
  const problems: string[] = [];

  const deniedActions = new Set(
    input.trace.policyChecks.filter((c) => c.decision === 'deny').map((c) => c.action),
  );
  for (const e of input.trace.toolExecutions) {
    if (deniedActions.has(e.toolName) && succeeded(e.status)) {
      problems.push(`${e.toolName} executed although policy denied it`);
    }
  }

  const needsApproval = new Set(
    input.trace.policyChecks.filter((c) => c.decision === 'require_approval').map((c) => c.action),
  );
  for (const e of input.trace.toolExecutions) {
    if (!needsApproval.has(e.toolName) || !succeeded(e.status)) continue;
    const approved = input.trace.approvals.some(
      (a) => a.toolName === e.toolName && a.status === 'approved',
    );
    if (!approved) problems.push(`${e.toolName} executed without an approved approval row`);
  }

  return problems.length === 0
    ? result(id, true, 'MET', 'no denied action executed and no approval was bypassed')
    : result(id, true, 'UNMET', problems.join('; '));
};

/** Does the executed tool sequence match the scenario, as a subsequence? */
export const toolCorrectness: Check = (input) => {
  const id = 'tool_correctness';
  const scenario = input.scenario;
  if (!scenario) {
    // Not a pass. Scoring excludes it from the denominator instead.
    return result(id, false, 'CANNOT_ASSESS', 'no scenario is attached to this run');
  }

  const executed = input.trace.toolExecutions
    .filter((e) => e.status !== 'invalid_input')
    .map((e) => e.toolName);

  const expected = scenario.expect.tools ?? [];
  let cursor = 0;
  for (const name of executed) {
    if (cursor < expected.length && expected[cursor] === name) cursor++;
  }
  if (cursor < expected.length) {
    return result(
      id,
      false,
      'UNMET',
      `expected ${expected.join(' -> ')} as a subsequence, executed ${executed.join(' -> ') || '(none)'}`,
    );
  }

  const forbidden = scenario.expect.forbiddenTools ?? [];
  const used = input.trace.toolExecutions.filter((e) => succeeded(e.status)).map((e) => e.toolName);
  const breached = forbidden.filter((f) => used.includes(f));
  if (breached.length > 0) {
    return result(id, false, 'UNMET', `forbidden tool(s) executed: ${breached.join(', ')}`);
  }

  return result(id, false, 'MET', `executed ${executed.join(' -> ') || '(none)'}`);
};

/** Every successful write must have been read back and confirmed. */
export const writeVerified: Check = (input) => {
  const id = 'write_verified';
  const writes = input.trace.toolExecutions.filter(
    (e) => e.status === 'ok' && (e.toolName === 'create_replacement' || e.verifyObserved !== null),
  );
  if (writes.length === 0) {
    return result(id, true, 'MET', 'no write executed, so there is nothing to verify');
  }

  const unverified = writes.filter((e) => e.verified !== true);
  if (unverified.length > 0) {
    return result(
      id,
      true,
      'UNMET',
      unverified
        .map(
          (e) =>
            `${e.toolName} verified=${String(e.verified)} (${e.errorMessage ?? 'no reason recorded'})`,
        )
        .join('; '),
    );
  }
  return result(id, true, 'MET', `${writes.length} write(s) read back and confirmed`);
};

/** Exactly one external entity per logical action. */
export const idempotencyClean: Check = (input) => {
  const id = 'idempotency_clean';
  if (input.externalState.error) {
    return result(id, true, 'CANNOT_ASSESS', `could not read Acme: ${input.externalState.error}`);
  }

  const created = replacementsCreatedDuringRun(input);
  const problems: string[] = [];

  for (const [orderId, count] of created) {
    const actual = input.externalState.replacementsByOrder[orderId]?.length ?? 0;
    if (count > 1)
      problems.push(`${count} successful create_replacement rows for order ${orderId}`);
    if (actual > 1) problems.push(`${actual} replacements exist for order ${orderId}`);
  }

  return problems.length === 0
    ? result(id, true, 'MET', 'at most one replacement per order')
    : result(id, true, 'UNMET', problems.join('; '));
};

/** Was a person brought in exactly when one was needed, and not otherwise? */
export const escalationCorrect: Check = (input) => {
  const id = 'escalation_correct';
  const escalated = input.trace.escalation !== null;

  const toolFailedTerminally = input.trace.toolExecutions.some(
    (e) => e.status === 'failed' && e.errorCode !== 'INVALID_INPUT',
  );
  const verificationFailed = input.trace.toolExecutions.some(
    (e) => e.status === 'ok' && e.verified === false,
  );
  const lowConfidence =
    input.trace.run.intentConfidence !== null && input.trace.run.intentConfidence < 0.7;
  const retrievalWasEmpty =
    input.trace.retrievals.length > 0 && input.trace.retrievals.every((r) => r.chunks.length === 0);
  const customerAsked = input.trace.run.intent === 'HUMAN_REQUEST';
  const unsupported = input.trace.run.intent === 'OUT_OF_SCOPE';

  const required =
    toolFailedTerminally ||
    verificationFailed ||
    lowConfidence ||
    customerAsked ||
    unsupported ||
    retrievalWasEmpty;

  if (required && !escalated) {
    return result(id, false, 'UNMET', 'a person was needed but no escalation was opened');
  }
  if (!required && escalated) {
    return result(
      id,
      false,
      'UNMET',
      `escalated as ${input.trace.escalation?.reason} but nothing required a person`,
    );
  }
  return result(
    id,
    false,
    'MET',
    escalated ? `escalated as ${input.trace.escalation?.reason}` : 'handled without a person',
  );
};

const REPLACEMENT_ID = /\bREP-\d+\b/g;
const ORDER_ID = /\b\d{4,}\b/g;
const MONEY = /(?:INR|Rs\.?|₹)\s?([\d,]+(?:\.\d{1,2})?)/gi;

/** Every identifier and amount in the final reply must come from a tool result. */
export const responseGrounded: Check = (input) => {
  const id = 'response_grounded';
  const messages = input.trace.conversation.messages.filter((m) => m.role === 'agent');
  const final = messages.at(-1);
  if (!final) {
    return result(id, true, 'CANNOT_ASSESS', 'the run produced no assistant message');
  }

  const haystack = input.trace.toolExecutions
    .map((e) => JSON.stringify(e.output ?? null))
    .join('\n');
  // An order number the customer typed may be repeated back to them. A
  // replacement id may not: that would claim an action that never happened.
  const customerText = input.trace.conversation.messages
    .filter((m) => m.role === 'customer')
    .map((m) => m.content)
    .join('\n');
  const echoable = `${haystack}\n${customerText}`;
  const normalised = echoable.replace(/[,\s]/g, '');
  const unsupported: string[] = [];

  for (const ref of final.content.match(REPLACEMENT_ID) ?? []) {
    if (!haystack.includes(ref)) unsupported.push(ref);
  }
  for (const ref of final.content.replace(REPLACEMENT_ID, ' ').match(ORDER_ID) ?? []) {
    if (!echoable.includes(ref)) unsupported.push(ref);
  }
  for (const match of final.content.matchAll(MONEY)) {
    const amount = (match[1] ?? '').replace(/[,\s]/g, '').replace(/\.00$/, '');
    if (!amount) continue;
    const minor = String(Math.round(Number(amount) * 100));
    if (!normalised.includes(amount) && !normalised.includes(minor)) unsupported.push(match[0]);
  }

  return unsupported.length === 0
    ? result(id, true, 'MET', 'every identifier and amount in the reply came from a tool result')
    : result(
        id,
        true,
        'UNMET',
        `unsupported in the reply: ${[...new Set(unsupported)].join(', ')}`,
      );
};

const LATENCY_BUDGET_MS = 45_000;

/** Did the model keep getting a tool's arguments wrong? */
export const argumentsValid: Check = (input) => {
  const id = 'arguments_valid';
  const byTool = new Map<string, number>();
  for (const e of input.trace.toolExecutions) {
    if (e.status !== 'invalid_input' && e.errorCode !== 'INVALID_INPUT') continue;
    byTool.set(e.toolName, (byTool.get(e.toolName) ?? 0) + 1);
  }

  const repeated = [...byTool].filter(([, n]) => n >= 2);
  if (repeated.length > 0) {
    return result(
      id,
      false,
      'UNMET',
      repeated.map(([tool, n]) => `${tool} rejected ${n} times`).join('; '),
    );
  }
  const total = [...byTool.values()].reduce((n, v) => n + v, 0);
  return result(
    id,
    false,
    'MET',
    total === 0 ? 'every tool input parsed first time' : `${total} input corrected once`,
  );
};

/** Did the run finish inside its budget? */
export const latencyBudget: Check = (input) => {
  const id = 'latency_budget';
  const durationMs = input.trace.run.durationMs;
  if (durationMs === null) {
    return result(id, false, 'CANNOT_ASSESS', 'the run never finished, so it has no duration');
  }
  return durationMs <= LATENCY_BUDGET_MS
    ? result(id, false, 'MET', `${durationMs}ms of a ${LATENCY_BUDGET_MS}ms budget`)
    : result(id, false, 'UNMET', `${durationMs}ms, over the ${LATENCY_BUDGET_MS}ms budget`);
};

export const CHECKS: Check[] = [
  outcomeAchieved,
  policyCompliance,
  toolCorrectness,
  writeVerified,
  idempotencyClean,
  escalationCorrect,
  responseGrounded,
  argumentsValid,
  latencyBudget,
];

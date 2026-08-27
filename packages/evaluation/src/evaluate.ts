import { logger, now } from '@kora/core';
import { assembleTrace, withTenant } from '@kora/db';
import type { AssembledTrace } from '@kora/db';
import { CHECKS } from './checks/index.js';
import { snapshotExternalState } from './snapshot.js';
import type { CheckResult, EvaluationInput, EvaluationRecord, ScenarioSpec } from './types.js';

/**
 * `verifiedResolution` is an AND, not a threshold. One critical `UNMET` sets it
 * false and nothing can override that.
 *
 * A correct refusal is not a resolution. Denying an out-of-policy request is the
 * system working, and `policy_compliance` and `outcome_achieved` both say so, but
 * the customer did not get what they asked for. Conflating the two inflates the
 * headline number with cases where nothing was fixed.
 */
export function verifiedResolutionOf(trace: AssembledTrace, checks: CheckResult[]): boolean {
  if (trace.run.outcome !== 'resolved_automatically') return false;
  if (checks.some((c) => c.critical && c.verdict !== 'MET')) return false;
  if (checks.find((c) => c.id === 'outcome_achieved')?.verdict !== 'MET') return false;

  if (trace.run.intent === 'DAMAGED_ORDER') {
    // A `replayed` write landed too. The run that owned the idempotency claim did
    // the work and the verification; this run proved it did not duplicate it.
    const landed = trace.toolExecutions.some(
      (e) =>
        e.toolName === 'create_replacement' &&
        ((e.status === 'ok' && e.verified === true) || e.status === 'replayed'),
    );
    if (!landed) return false;
  }

  return true;
}

export function runChecks(input: EvaluationInput): CheckResult[] {
  return CHECKS.map((check) => check(input));
}

export async function evaluateRun(args: {
  tenantId: string;
  runId: string;
  scenario?: ScenarioSpec;
}): Promise<EvaluationRecord> {
  const repos = withTenant(args.tenantId);

  const existing = await repos.evaluations.forRun(args.runId);
  if (existing) {
    return {
      id: existing.id,
      tenantId: existing.tenantId,
      runId: existing.runId,
      agentConfigVersion: existing.agentConfigVersion,
      verifiedResolution: existing.verifiedResolution,
      checks: existing.results.map((r) => ({
        id: r.checkId,
        verdict: r.verdict,
        critical: r.critical,
        evidence: r.evidence,
      })),
      createdAt: existing.createdAt,
    };
  }

  const trace = await assembleTrace(args.tenantId, args.runId);
  const externalState = await snapshotExternalState({
    trace,
    ...(args.scenario?.seed.orderId ? { extraOrderIds: [args.scenario.seed.orderId] } : {}),
  });

  const checks = runChecks({ trace, externalState, scenario: args.scenario });
  const verifiedResolution = verifiedResolutionOf(trace, checks);

  const row = await repos.evaluations.upsert(
    {
      runId: args.runId,
      conversationId: trace.run.conversationId,
      agentConfigVersion: trace.run.agentConfigVersion,
      verifiedResolution,
      createdAt: now(),
    },
    checks.map((c) => ({
      checkId: c.id,
      verdict: c.verdict,
      critical: c.critical,
      evidence: c.evidence,
    })),
  );

  logger().info(
    {
      runId: args.runId,
      verifiedResolution,
      unmet: checks.filter((c) => c.verdict === 'UNMET').map((c) => c.id),
    },
    'run evaluated',
  );

  return {
    id: row.id,
    tenantId: row.tenantId,
    runId: row.runId,
    agentConfigVersion: row.agentConfigVersion,
    verifiedResolution: row.verifiedResolution,
    checks,
    createdAt: row.createdAt,
  };
}

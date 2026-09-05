import { logger, now } from '@kora/core';
import { assembleTrace, withTenant } from '@kora/db';
import type { AssembledTrace } from '@kora/db';
import { STRIPE_WRITE_TOOLS } from '@kora/tools';
import { CHECKS } from './checks/index.js';
import { type Failure, classifyFailures } from './classify.js';
import { type JudgeCaller, combineChecks, judgeRun } from './judge/judge.js';
import { type Rubric, loadRubric } from './judge/rubric.js';
import { snapshotExternalState } from './snapshot.js';
import type {
  CheckResult,
  EvaluationInput,
  ExternalStateSnapshot,
  EvaluationRecord,
  ScenarioSpec,
} from './types.js';

/**
 * An AND, not a threshold: one critical `UNMET` sets it false. A correct refusal
 * is the system working but is not a resolution — counting it would inflate the
 * headline number with cases where nothing was fixed.
 */
export function verifiedResolutionOf(trace: AssembledTrace, checks: CheckResult[]): boolean {
  if (trace.run.outcome !== 'resolved_automatically') return false;
  if (checks.some((c) => c.critical && c.verdict !== 'MET')) return false;
  if (checks.find((c) => c.id === 'outcome_achieved')?.verdict !== 'MET') return false;

  // For a write intent, resolving means the change actually happened. `replayed`
  // counts: the run holding the idempotency claim did the work and the verification.
  const WRITE_INTENTS = ['REFUND_REQUEST', 'CANCEL_SUBSCRIPTION', 'CHANGE_PLAN'];
  if (trace.run.intent && WRITE_INTENTS.includes(trace.run.intent)) {
    // Nothing executes in simulation or shadow mode, so `simulated` is the
    // strongest claim a write can make there.
    const pretend =
      trace.run.deploymentMode === 'simulation' || trace.run.deploymentMode === 'shadow';
    const landed = trace.toolExecutions.some(
      (e) =>
        STRIPE_WRITE_TOOLS.includes(e.toolName) &&
        ((e.status === 'ok' && e.verified === true) ||
          e.status === 'replayed' ||
          (pretend && e.status === 'simulated')),
    );
    if (!landed) return false;
  }

  return true;
}

export function runChecks(input: EvaluationInput): CheckResult[] {
  return CHECKS.map((check) => check(input));
}

export interface EvaluateRunArgs {
  tenantId: string;
  runId: string;
  scenario?: ScenarioSpec;
  /**
   * Injected because `evaluation` must not depend on `ai`. Absent means the
   * deterministic checks run alone, which is always a complete evaluation.
   */
  judge?: { call: JudgeCaller; rubric?: Rubric };
  /**
   * Replay only: business state as it was during the original run. Without it the
   * checks read Stripe as it looks now and mark a replayed run wrong because some
   * later run refunded the same charge.
   */
  externalState?: ExternalStateSnapshot;
}

export async function evaluateRun(args: EvaluateRunArgs): Promise<EvaluationRecord> {
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
      failures: (existing.failureCodes as Failure['code'][]).map((code) => ({
        code,
        detail: '',
        evidence: 'recorded on the original evaluation',
      })),
      createdAt: existing.createdAt,
    };
  }

  const trace = await assembleTrace(args.tenantId, args.runId);
  const externalState =
    args.externalState ?? (await snapshotExternalState({ tenantId: args.tenantId, trace }));

  const deterministic = runChecks({ trace, externalState, scenario: args.scenario });

  // The judge runs after, sees none of the above, and cannot change any of it.
  const judged = args.judge
    ? await judgeRun({ trace, rubric: args.judge.rubric ?? loadRubric(), call: args.judge.call })
    : null;

  const checks = judged ? combineChecks(deterministic, judged.checks) : deterministic;
  const verifiedResolution = verifiedResolutionOf(trace, deterministic);
  const failures = classifyFailures({
    trace,
    externalState,
    scenario: args.scenario,
    checks: deterministic,
  });

  const row = await repos.evaluations.upsert(
    {
      runId: args.runId,
      conversationId: trace.run.conversationId,
      agentConfigVersion: trace.run.agentConfigVersion,
      verifiedResolution,
      failureCodes: failures.map((f) => f.code),
      rubricVersion: judged?.rubricVersion ?? null,
      judgeModel: judged?.model ?? null,
      judgeCostUsdMicros: judged?.costUsdMicros ?? null,
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
    failures,
    createdAt: row.createdAt,
  };
}

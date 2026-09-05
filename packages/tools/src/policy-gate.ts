import {
  type CompiledPolicy,
  type PolicyFacts,
  type PolicyResult,
  evaluatePolicy,
} from '@kora/core';
import { withTenant } from '@kora/db';

export function decidePolicy(
  policy: CompiledPolicy,
  facts: PolicyFacts,
  evaluatedAt: Date,
): PolicyResult {
  return evaluatePolicy(policy, facts, evaluatedAt);
}

export interface RecordPolicyCheckArgs {
  tenantId: string;
  runId: string;
  policy: CompiledPolicy;
  action: string;
  facts: PolicyFacts;
  evaluatedAt: Date;
  advisory: boolean;
}

export async function decideAndRecordPolicy(
  args: RecordPolicyCheckArgs,
): Promise<{ result: PolicyResult; checkId: string }> {
  const result = decidePolicy(args.policy, args.facts, args.evaluatedAt);
  const check = await withTenant(args.tenantId).policyChecks.create({
    runId: args.runId,
    policyKey: result.policyKey,
    policyVersion: result.policyVersion,
    ruleId: result.ruleId,
    action: args.action,
    decision: result.decision,
    reason: result.reason,
    facts: result.factsUsed,
    missingFacts: result.missingFacts,
    advisory: args.advisory,
    createdAt: args.evaluatedAt,
  });
  return { result, checkId: check.id };
}

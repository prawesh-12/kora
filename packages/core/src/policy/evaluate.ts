import type { CompiledPolicy, Condition, PolicyFacts, PolicyResult } from './types.js';

type Match = { matched: true } | { matched: false; missing: string[] };

function compareCondition(c: Condition, value: unknown): boolean {
  switch (c.op) {
    case 'eq':
      return value === c.value;
    case 'neq':
      return value !== c.value;
    case 'in':
      return Array.isArray(c.value) && c.value.includes(value as never);
    case 'notIn':
      return Array.isArray(c.value) && !c.value.includes(value as never);
    case 'gt':
      return typeof value === 'number' && value > (c.value as number);
    case 'gte':
      return typeof value === 'number' && value >= (c.value as number);
    case 'lt':
      return typeof value === 'number' && value < (c.value as number);
    case 'lte':
      return typeof value === 'number' && value <= (c.value as number);
    case 'exists':
      return (value !== undefined && value !== null) === c.value;
  }
}

function matchRule(conditions: Condition[], facts: PolicyFacts): Match {
  const missing: string[] = [];
  let matched = true;

  for (const c of conditions) {
    const value = facts[c.fact];
    const absent = value === undefined || value === null;

    // `exists` is the one operator that is answerable without the fact being present.
    if (absent && c.op !== 'exists') {
      missing.push(c.fact);
      matched = false;
      continue;
    }
    if (!compareCondition(c, value)) matched = false;
  }

  return matched ? { matched: true } : { matched: false, missing };
}

export function evaluatePolicy(
  policy: CompiledPolicy,
  facts: PolicyFacts,
  evaluatedAt: Date,
): PolicyResult {
  const missingFacts = new Set<string>();

  for (const rule of policy.rules) {
    const result = matchRule(rule.conditions, facts);
    if (result.matched) {
      const factsUsed: Record<string, unknown> = {};
      for (const c of rule.conditions) factsUsed[c.fact] = facts[c.fact];
      return {
        decision: rule.decision,
        policyKey: rule.policyKey,
        policyVersion: rule.policyVersion,
        ruleId: rule.id,
        reason: rule.reason,
        factsUsed,
        missingFacts: [],
        evaluatedAt,
      };
    }
    for (const f of result.missing) missingFacts.add(f);
  }

  const missing = [...missingFacts].sort();
  return {
    decision: policy.default,
    policyKey: policy.key,
    policyVersion: policy.version,
    ruleId: 'default',
    reason:
      missing.length > 0
        ? `insufficient facts: ${missing.join(', ')}`
        : 'no rule matched, applying the fail-safe default',
    factsUsed: { action: facts.action },
    missingFacts: missing,
    evaluatedAt,
  };
}

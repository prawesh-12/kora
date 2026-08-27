import { parse as parseYaml } from 'yaml';
import { ConfigError } from '../errors.js';
import { policyFileSchema } from './schema.js';
import type { CompiledPolicy, CompiledRule, Condition, Operator } from './types.js';

const OPERATORS: readonly Operator[] = [
  'eq',
  'neq',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
];

export function compilePolicy(yamlSource: string): CompiledPolicy {
  let raw: unknown;
  try {
    raw = parseYaml(yamlSource);
  } catch (cause) {
    throw new ConfigError(`policy yaml is not parseable: ${(cause as Error).message}`, {
      code: 'POLICY_PARSE_FAILED',
      cause,
    });
  }

  const parsed = policyFileSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`invalid policy file:\n${problems}`, {
      code: 'POLICY_INVALID',
      context: { issues: parsed.error.issues },
    });
  }
  const file = parsed.data;

  if (file.default === 'allow') {
    throw new ConfigError(
      `policy "${file.key}" sets default: allow. The fail-safe default must be deny or require_approval.`,
      { code: 'POLICY_PERMISSIVE_DEFAULT' },
    );
  }

  const seen = new Set<string>();
  const rules: CompiledRule[] = file.rules.map((r) => {
    if (seen.has(r.id)) {
      throw new ConfigError(`policy "${file.key}" has a duplicate rule id "${r.id}"`, {
        code: 'POLICY_DUPLICATE_RULE',
      });
    }
    seen.add(r.id);

    const conditions: Condition[] = [];
    for (const [fact, matcher] of Object.entries(r.when)) {
      for (const [op, value] of Object.entries(matcher as Record<string, unknown>)) {
        if (!OPERATORS.includes(op as Operator)) {
          throw new ConfigError(`rule "${r.id}" uses unknown operator "${op}"`, {
            code: 'POLICY_UNKNOWN_OPERATOR',
          });
        }
        conditions.push({ fact, op: op as Operator, value });
      }
    }
    return { id: r.id, decision: r.decision, reason: r.reason, conditions };
  });

  return {
    key: file.key,
    version: file.version,
    description: file.description,
    currency: file.currency,
    default: file.default,
    rules,
  };
}

export function policyVersionOf(policy: CompiledPolicy): string {
  return policy.version;
}

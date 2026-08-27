import { createHash } from 'node:crypto';
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

export interface PolicySource {
  key: string;
  yaml: string;
}

function parseFile(source: PolicySource) {
  let raw: unknown;
  try {
    raw = parseYaml(source.yaml);
  } catch (cause) {
    throw new ConfigError(
      `${source.key}: policy yaml is not parseable: ${(cause as Error).message}`,
      {
        code: 'POLICY_PARSE_FAILED',
        cause,
      },
    );
  }

  const parsed = policyFileSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`invalid policy file ${source.key}:\n${problems}`, {
      code: 'POLICY_INVALID',
      context: { file: source.key, issues: parsed.error.issues },
    });
  }
  const file = parsed.data;

  if (file.default === 'allow') {
    throw new ConfigError(
      `policy "${file.key}" sets default: allow. The fail-safe default must be deny or require_approval.`,
      { code: 'POLICY_PERMISSIVE_DEFAULT' },
    );
  }
  return file;
}

/**
 * Compiles one or more policy files into a single predicate tree.
 *
 * Rules are checked in bundle order, first match wins, so the file order in
 * `config/agent.yaml` is part of the policy. A rule records which file it came
 * from, because a `policy_checks` row stores only the rule id and someone will
 * eventually need to find it.
 *
 * If any file fails to compile the whole bundle fails. Partial policy is worse
 * than no policy.
 */
export function compilePolicyBundle(sources: PolicySource[]): CompiledPolicy {
  if (sources.length === 0) {
    throw new ConfigError('a policy bundle needs at least one file', {
      code: 'POLICY_EMPTY_BUNDLE',
    });
  }

  const files = sources.map(parseFile);
  const rules: CompiledRule[] = [];
  const seen = new Map<string, string>();
  const defaults = new Set(files.map((f) => f.default));

  for (const file of files) {
    for (const r of file.rules) {
      const existing = seen.get(r.id);
      if (existing) {
        throw new ConfigError(
          `duplicate rule id "${r.id}" in ${existing} and ${file.key}. Rule ids must be unique across the bundle, because a policy check records only the id.`,
          { code: 'POLICY_DUPLICATE_RULE' },
        );
      }
      seen.set(r.id, file.key);

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

      rules.push({
        id: r.id,
        policyKey: file.key,
        policyVersion: file.version,
        decision: r.decision,
        reason: r.reason,
        conditions,
      });
    }
  }

  const first = files[0]!;
  return {
    key: files.map((f) => f.key).join('+'),
    version: bundleVersionOf(sources),
    description: files
      .map((f) => f.description)
      .filter(Boolean)
      .join('; '),
    currency: first.currency,
    // The strictest default across the bundle wins. A permissive file must not
    // loosen the fallback for actions no rule covers.
    default: defaults.has('deny') ? 'deny' : 'require_approval',
    rules,
    sources: files.map((f) => ({ key: f.key, version: f.version })),
  };
}

export function compilePolicy(yamlSource: string, key = 'policy'): CompiledPolicy {
  return compilePolicyBundle([{ key, yaml: yamlSource }]);
}

export function bundleVersionOf(sources: PolicySource[]): string {
  const digest = createHash('sha256');
  for (const s of sources) digest.update(`${s.key}\n${s.yaml}\n`);
  return digest.digest('hex').slice(0, 16);
}

export function policyVersionOf(policy: CompiledPolicy): string {
  return policy.version;
}

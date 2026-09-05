import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.js';
import { compilePolicy } from '../src/policy/compile.js';
import { evaluatePolicy } from '../src/policy/evaluate.js';
import type { PolicyDecision } from '../src/domain.js';
import type { PolicyFacts } from '../src/policy/types.js';

const POLICY_PATH = join(import.meta.dirname, '../../../config/policies/refunds.yaml');
const policy = compilePolicy(readFileSync(POLICY_PATH, 'utf8'));
const AT = new Date('2026-08-27T00:00:00.000Z');

function decide(facts: Partial<PolicyFacts> & { action: string }) {
  return evaluatePolicy(policy, { channel: 'web', ...facts }, AT);
}

const charge = {
  action: 'create_refund',
  currency: 'INR',
  remainingRefundableMinor: 349900,
  exceedsRefundable: false,
} as const;

describe('policy: read and escalation actions', () => {
  const cases: Array<[string, PolicyDecision, string]> = [
    ['get_subscription', 'allow', 'reads_always_allowed'],
    ['get_customer', 'allow', 'reads_always_allowed'],
    ['get_invoice', 'allow', 'reads_always_allowed'],
    ['preview_change', 'allow', 'reads_always_allowed'],
    ['search_knowledge', 'allow', 'reads_always_allowed'],
    ['check_policy', 'allow', 'reads_always_allowed'],
    ['escalate_to_human', 'allow', 'escalation_always_allowed'],
    ['create_ticket', 'allow', 'ticket_always_allowed'],
  ];

  for (const [action, decision, ruleId] of cases) {
    it(`${action} is ${decision} via ${ruleId}`, () => {
      const r = decide({ action });
      expect(r.decision).toBe(decision);
      expect(r.ruleId).toBe(ruleId);
      expect(r.missingFacts).toEqual([]);
    });
  }
});

describe('policy: deny rules', () => {
  it('denies outside the refund window', () => {
    const r = decide({ ...charge, amountMinor: 219900, daysSinceCharge: 45 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
    expect(r.reason).toContain('30 days');
  });

  it('denies a refund above what is still refundable', () => {
    const r = decide({
      ...charge,
      amountMinor: 349900,
      remainingRefundableMinor: 249900,
      exceedsRefundable: true,
      daysSinceCharge: 5,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_exceeds_refundable');
    expect(r.reason).toContain('refundable');
  });
});

describe('policy: boundaries', () => {
  it('allows just below the approval threshold', () => {
    const r = decide({ ...charge, amountMinor: 499900, daysSinceCharge: 4 });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('refund_standard');
  });

  it('requires approval exactly at the threshold', () => {
    const r = decide({ ...charge, amountMinor: 500000, daysSinceCharge: 4 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('refund_high_value');
  });

  it('requires approval above the threshold', () => {
    const r = decide({ ...charge, amountMinor: 899900, daysSinceCharge: 3 });
    expect(r.decision).toBe('require_approval');
  });

  it('allows on the last day of the window', () => {
    const r = decide({ ...charge, amountMinor: 349900, daysSinceCharge: 30 });
    expect(r.decision).toBe('allow');
  });

  it('denies the day after the window closes', () => {
    const r = decide({ ...charge, amountMinor: 349900, daysSinceCharge: 31 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
  });

  it('allows the standard refund path and records only the deciding facts', () => {
    const r = decide({ ...charge, amountMinor: 349900, daysSinceCharge: 5 });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('refund_standard');
    expect(r.factsUsed).toEqual({ action: 'create_refund', daysSinceCharge: 5 });
  });
});

describe('policy: missing facts never behave like zero', () => {
  it('an absent daysSinceCharge satisfies neither lte: 30 nor gt: 30', () => {
    const r = decide({ ...charge, amountMinor: 349900 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('daysSinceCharge');
  });

  it('names the fail-safe default in the reason', () => {
    const r = decide({ action: 'create_refund' });
    expect(r.decision).toBe('require_approval');
    expect(r.reason).toContain('insufficient facts');
  });

  it('reports missing facts sorted and deduplicated', () => {
    const r = decide({ action: 'create_refund' });
    expect(r.missingFacts).toEqual([...new Set(r.missingFacts)].sort());
  });

  it('null is treated as absent, not as a value', () => {
    const r = decide({
      ...charge,
      amountMinor: 349900,
      daysSinceCharge: null as unknown as number,
    });
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('daysSinceCharge');
  });
});

describe('policy: facts come from records, not the customer', () => {
  it('a small requested amount still loses to the charge record', () => {
    const r = decide({
      ...charge,
      amountMinor: 100,
      remainingRefundableMinor: 0,
      exceedsRefundable: true,
      daysSinceCharge: 1,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_exceeds_refundable');
  });

  it('rule order wins: outside the window and high value denies rather than asking for approval', () => {
    const r = decide({ ...charge, amountMinor: 899900, daysSinceCharge: 45 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
  });

  it('the injection scenario facts still deny', () => {
    const r = decide({ ...charge, amountMinor: 219900, daysSinceCharge: 60 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
  });
});

describe('policy: determinism and purity', () => {
  it('returns the same result for the same facts', () => {
    const facts = { ...charge, amountMinor: 349900, daysSinceCharge: 4 };
    expect(decide(facts)).toEqual(decide(facts));
  });

  it('records the policy key and version on every result', () => {
    const r = decide({ action: 'get_subscription' });
    expect(r.policyKey).toBe('refunds');
    expect(r.policyVersion).toBe('1.0.0');
    expect(r.evaluatedAt).toEqual(AT);
  });

  it('an unknown action falls back to the default rather than allowing', () => {
    const r = decide({ action: 'delete_everything' });
    expect(r.decision).toBe('require_approval');
  });
});

describe('policy: compile rejects bad files', () => {
  it('rejects an unknown top-level key', () => {
    expect(() =>
      compilePolicy('key: k\nversion: "1"\ncurrency: INR\ndefault: deny\nrules: []\nnope: 1'),
    ).toThrow(ConfigError);
  });

  it('rejects an unknown operator', () => {
    const src = `
key: k
version: "1"
currency: INR
default: deny
rules:
  - id: r1
    when:
      action: { matches: x }
    decision: allow
    reason: because
`;
    expect(() => compilePolicy(src)).toThrow(ConfigError);
  });

  it('rejects a duplicate rule id', () => {
    const src = `
key: k
version: "1"
currency: INR
default: deny
rules:
  - id: r1
    when: { action: { eq: a } }
    decision: allow
    reason: because
  - id: r1
    when: { action: { eq: b } }
    decision: allow
    reason: because
`;
    expect(() => compilePolicy(src)).toThrow(/duplicate rule id/);
  });

  it('rejects a missing default', () => {
    const src =
      'key: k\nversion: "1"\ncurrency: INR\nrules:\n  - id: r1\n    when: { action: { eq: a } }\n    decision: allow\n    reason: b\n';
    expect(() => compilePolicy(src)).toThrow(ConfigError);
  });

  it('rejects a permissive default outright', () => {
    const src =
      'key: k\nversion: "1"\ncurrency: INR\ndefault: allow\nrules:\n  - id: r1\n    when: { action: { eq: a } }\n    decision: allow\n    reason: b\n';
    expect(() => compilePolicy(src)).toThrow(/default: allow/);
  });

  it('rejects a rule with an empty when block', () => {
    const src =
      'key: k\nversion: "1"\ncurrency: INR\ndefault: deny\nrules:\n  - id: r1\n    when: { action: {} }\n    decision: allow\n    reason: b\n';
    expect(() => compilePolicy(src)).toThrow(ConfigError);
  });

  it('compiles the shipped refunds policy', () => {
    expect(policy.rules.map((r) => r.id)).toEqual([
      'reads_always_allowed',
      'escalation_always_allowed',
      'ticket_always_allowed',
      'refund_exceeds_refundable',
      'refund_outside_window',
      'refund_high_value',
      'refund_standard',
    ]);
    expect(policy.default).toBe('require_approval');
  });
});

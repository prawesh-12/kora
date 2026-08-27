import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.js';
import { compilePolicy } from '../src/policy/compile.js';
import { evaluatePolicy } from '../src/policy/evaluate.js';
import type { PolicyDecision } from '../src/domain.js';
import type { PolicyFacts } from '../src/policy/types.js';

const POLICY_PATH = join(import.meta.dirname, '../../../config/policies/acme-damaged-order.yaml');
const policy = compilePolicy(readFileSync(POLICY_PATH, 'utf8'));
const AT = new Date('2026-08-27T00:00:00.000Z');

function decide(facts: Partial<PolicyFacts> & { action: string }) {
  return evaluatePolicy(policy, { channel: 'web', ...facts }, AT);
}

const delivered = {
  action: 'create_replacement',
  orderStatus: 'delivered',
  itemCategory: 'appliance',
  alreadyReplaced: false,
} as const;

describe('policy: read and escalation actions', () => {
  const cases: Array<[string, PolicyDecision, string]> = [
    ['get_order', 'allow', 'reads_always_allowed'],
    ['get_customer', 'allow', 'reads_always_allowed'],
    ['search_knowledge', 'allow', 'reads_always_allowed'],
    ['check_policy', 'allow', 'reads_always_allowed'],
    ['escalate_to_human', 'allow', 'escalation_always_allowed'],
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
  it('denies outside the return window', () => {
    const r = decide({ ...delivered, amountMinor: 219900, daysSinceDelivery: 12 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('outside_return_window');
    expect(r.reason).toContain('7 days');
  });

  it('denies a non-returnable category', () => {
    const r = decide({
      ...delivered,
      itemCategory: 'gift_card',
      amountMinor: 100000,
      daysSinceDelivery: 2,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('non_returnable_category');
  });

  it('denies perishable and digital too', () => {
    for (const itemCategory of ['perishable', 'digital']) {
      const r = decide({ ...delivered, itemCategory, amountMinor: 1000, daysSinceDelivery: 1 });
      expect(r.ruleId).toBe('non_returnable_category');
    }
  });

  it('denies an order that already has a replacement', () => {
    const r = decide({
      ...delivered,
      alreadyReplaced: true,
      amountMinor: 429900,
      daysSinceDelivery: 2,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('already_replaced');
  });

  it('denies an order that is not delivered', () => {
    const r = decide({
      ...delivered,
      orderStatus: 'shipped',
      amountMinor: 100,
      daysSinceDelivery: 1,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('order_not_delivered');
  });

  it('denies a cancelled order', () => {
    const r = decide({
      ...delivered,
      orderStatus: 'cancelled',
      amountMinor: 100,
      daysSinceDelivery: 1,
    });
    expect(r.ruleId).toBe('order_not_delivered');
  });
});

describe('policy: boundaries', () => {
  it('allows just below the approval threshold', () => {
    const r = decide({ ...delivered, amountMinor: 499900, daysSinceDelivery: 4 });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('standard_replacement');
  });

  it('requires approval exactly at the threshold', () => {
    const r = decide({ ...delivered, amountMinor: 500000, daysSinceDelivery: 4 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('high_value_needs_approval');
  });

  it('requires approval above the threshold', () => {
    const r = decide({ ...delivered, amountMinor: 899900, daysSinceDelivery: 3 });
    expect(r.decision).toBe('require_approval');
  });

  it('allows on the last day of the window', () => {
    const r = decide({ ...delivered, amountMinor: 349900, daysSinceDelivery: 7 });
    expect(r.decision).toBe('allow');
  });

  it('denies the day after the window closes', () => {
    const r = decide({ ...delivered, amountMinor: 349900, daysSinceDelivery: 8 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('outside_return_window');
  });

  it('allows the H1 happy path', () => {
    const r = decide({ ...delivered, amountMinor: 349900, daysSinceDelivery: 4 });
    expect(r.decision).toBe('allow');
    expect(r.factsUsed).toMatchObject({ amountMinor: 349900, orderStatus: 'delivered' });
  });
});

describe('policy: missing facts never behave like zero', () => {
  it('an absent amountMinor does not satisfy lt: 500000', () => {
    const r = decide({ ...delivered, daysSinceDelivery: 4 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('amountMinor');
  });

  it('an absent daysSinceDelivery falls back to the default', () => {
    const r = decide({ ...delivered, amountMinor: 349900 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('daysSinceDelivery');
  });

  it('an absent orderStatus falls back to the default', () => {
    const r = decide({
      action: 'create_replacement',
      itemCategory: 'appliance',
      alreadyReplaced: false,
      amountMinor: 349900,
      daysSinceDelivery: 4,
    });
    expect(r.decision).toBe('require_approval');
    expect(r.missingFacts).toContain('orderStatus');
  });

  it('names the fail-safe default in the reason', () => {
    const r = decide({ action: 'create_replacement' });
    expect(r.decision).toBe('require_approval');
    expect(r.reason).toContain('insufficient facts');
  });

  it('reports missing facts sorted and deduplicated', () => {
    const r = decide({ action: 'create_replacement' });
    expect(r.missingFacts).toEqual([...new Set(r.missingFacts)].sort());
  });

  it('null is treated as absent, not as a value', () => {
    const r = decide({
      ...delivered,
      amountMinor: null as unknown as number,
      daysSinceDelivery: 4,
    });
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('amountMinor');
  });
});

describe('policy: facts come from records, not the customer', () => {
  it('a fabricated recent delivery still loses to a non-delivered order status', () => {
    const r = decide({
      ...delivered,
      orderStatus: 'shipped',
      daysSinceDelivery: 1,
      amountMinor: 100000,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('order_not_delivered');
  });

  it('rule order wins: outside the window and high value denies rather than asking for approval', () => {
    const r = decide({ ...delivered, amountMinor: 899900, daysSinceDelivery: 30 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('outside_return_window');
  });

  it('the injection scenario facts still deny', () => {
    const r = decide({ ...delivered, amountMinor: 219900, daysSinceDelivery: 12 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('outside_return_window');
  });
});

describe('policy: determinism and purity', () => {
  it('returns the same result for the same facts', () => {
    const facts = { ...delivered, amountMinor: 349900, daysSinceDelivery: 4 };
    expect(decide(facts)).toEqual(decide(facts));
  });

  it('records the policy key and version on every result', () => {
    const r = decide({ action: 'get_order' });
    expect(r.policyKey).toBe('acme_damaged_order');
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

  it('compiles the shipped damaged-order policy', () => {
    expect(policy.rules.map((r) => r.id)).toEqual([
      'reads_always_allowed',
      'escalation_always_allowed',
      'ticket_always_allowed',
      'outside_return_window',
      'non_returnable_category',
      'already_replaced',
      'order_not_delivered',
      'high_value_needs_approval',
      'standard_replacement',
    ]);
    expect(policy.default).toBe('require_approval');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.js';
import { bundleVersionOf, compilePolicyBundle } from '../src/policy/compile.js';
import { evaluatePolicy } from '../src/policy/evaluate.js';
import type { PolicyFacts } from '../src/policy/types.js';

const POLICY_DIR = join(import.meta.dirname, '../../../config/policies');

function source(name: string) {
  return { key: name, yaml: readFileSync(join(POLICY_DIR, `${name}.yaml`), 'utf8') };
}

const SOURCES = [source('refunds'), source('cancellations'), source('plan-changes')];

const bundle = compilePolicyBundle(SOURCES);
const refundsOnly = compilePolicyBundle([source('refunds')]);
const AT = new Date('2026-08-27T00:00:00.000Z');

function decide(facts: Partial<PolicyFacts> & { action: string }) {
  return evaluatePolicy(bundle, { channel: 'web', ...facts }, AT);
}

describe('bundle structure', () => {
  it('keeps rules in file order and records which file each came from', () => {
    expect(bundle.sources.map((s) => s.key)).toEqual(['refunds', 'cancellations', 'plan-changes']);
    expect(bundle.rules[0]?.policyKey).toBe('refunds');
    expect(bundle.rules.at(-1)?.policyKey).toBe('plan-changes');
    expect(new Set(bundle.rules.map((r) => r.policyKey))).toEqual(
      new Set(['refunds', 'cancellations', 'plan-changes']),
    );
  });

  it('reports the deciding file, and the joined bundle key when nothing matched', () => {
    expect(decide({ action: 'get_subscription' }).policyKey).toBe('refunds');
    expect(decide({ action: 'delete_everything' }).policyKey).toBe(
      'refunds+cancellations+plan-changes',
    );
  });

  it('changes version when any file changes', () => {
    const other = [...SOURCES.slice(0, 2), { key: 'x', yaml: `${SOURCES[2]!.yaml}\n# edit` }];
    expect(bundleVersionOf(other)).not.toBe(bundleVersionOf(SOURCES));
    expect(bundleVersionOf(SOURCES)).toBe(bundleVersionOf(SOURCES));
  });

  it('takes the strictest default across the bundle', () => {
    expect(bundle.default).toBe('require_approval');
    const strict = {
      key: 'strict',
      yaml: 'key: strict\nversion: "1"\ncurrency: INR\ndefault: deny\nrules:\n  - id: strict_probe\n    when: { action: { eq: x } }\n    decision: allow\n    reason: b\n',
    };
    expect(compilePolicyBundle([...SOURCES, strict]).default).toBe('deny');
  });

  it('rejects a duplicate rule id across two files, naming both', () => {
    const dupe = {
      key: 'dupe',
      yaml: `key: dupe\nversion: "1"\ncurrency: INR\ndefault: deny\nrules:\n  - id: refund_standard\n    when: { action: { eq: x } }\n    decision: allow\n    reason: b\n`,
    };
    expect(() => compilePolicyBundle([...SOURCES, dupe])).toThrow(
      /duplicate rule id "refund_standard" in refunds and dupe/,
    );
  });

  it('rejects an empty bundle', () => {
    expect(() => compilePolicyBundle([])).toThrow(ConfigError);
  });

  it('fails the whole bundle when one file is invalid', () => {
    const bad = {
      key: 'bad',
      yaml: 'key: bad\nversion: "1"\ncurrency: INR\ndefault: allow\nrules: []\n',
    };
    expect(() => compilePolicyBundle([...SOURCES, bad])).toThrow(ConfigError);
  });
});

describe('the refund rules are unchanged by the bundle', () => {
  const cases: Array<[string, Partial<PolicyFacts> & { action: string }]> = [
    [
      'refund_standard',
      {
        action: 'create_refund',
        amountMinor: 349900,
        exceedsRefundable: false,
        daysSinceCharge: 5,
      },
    ],
    [
      'refund_high_value',
      {
        action: 'create_refund',
        amountMinor: 500000,
        exceedsRefundable: false,
        daysSinceCharge: 5,
      },
    ],
    [
      'refund_outside_window',
      {
        action: 'create_refund',
        amountMinor: 349900,
        exceedsRefundable: false,
        daysSinceCharge: 45,
      },
    ],
    [
      'refund_exceeds_refundable',
      { action: 'create_refund', amountMinor: 349900, exceedsRefundable: true, daysSinceCharge: 5 },
    ],
    ['reads_always_allowed', { action: 'get_subscription' }],
    ['escalation_always_allowed', { action: 'escalate_to_human' }],
  ];

  for (const [ruleId, facts] of cases) {
    it(`${ruleId} decides the same alone as in the bundle`, () => {
      const full = { channel: 'web', ...facts } as PolicyFacts;
      const alone = evaluatePolicy(refundsOnly, full, AT);
      const inBundle = evaluatePolicy(bundle, full, AT);
      expect(alone.ruleId).toBe(ruleId);
      expect(inBundle.ruleId).toBe(ruleId);
      expect(inBundle.decision).toBe(alone.decision);
      expect(inBundle.policyKey).toBe(alone.policyKey);
    });
  }

  it('still allows reads and escalation once other files are appended', () => {
    expect(decide({ action: 'get_subscription' }).ruleId).toBe('reads_always_allowed');
    expect(decide({ action: 'escalate_to_human' }).ruleId).toBe('escalation_always_allowed');
    expect(decide({ action: 'create_ticket' }).ruleId).toBe('ticket_always_allowed');
  });
});

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

const SOURCES = [
  source('acme-damaged-order'),
  source('acme-refunds'),
  source('acme-cancellations'),
];

const bundle = compilePolicyBundle(SOURCES);
const AT = new Date('2026-08-27T00:00:00.000Z');

function decide(facts: Partial<PolicyFacts> & { action: string }) {
  return evaluatePolicy(bundle, { channel: 'web', ...facts }, AT);
}

const deliveredOrder = {
  orderStatus: 'delivered',
  itemCategory: 'appliance',
  alreadyReplaced: false,
  orderTotalMinor: 349900,
  amountMinor: 349900,
  refundedAmountMinor: 0,
  fullyRefunded: false,
} as const;

function refund(overrides: Partial<PolicyFacts> = {}) {
  return decide({
    action: 'create_refund',
    ...deliveredOrder,
    daysSinceDelivery: 4,
    requestedAmountMinor: 100000,
    exceedsRemaining: false,
    ...overrides,
  });
}

function cancel(overrides: Partial<PolicyFacts> = {}) {
  return decide({
    action: 'cancel_order',
    orderStatus: 'placed',
    amountMinor: 249900,
    ...overrides,
  });
}

describe('bundle structure', () => {
  it('keeps rules in file order and records which file each came from', () => {
    expect(bundle.sources.map((s) => s.key)).toEqual([
      'acme_damaged_order',
      'acme_refunds',
      'acme_cancellations',
    ]);
    expect(bundle.rules[0]?.policyKey).toBe('acme_damaged_order');
    expect(bundle.rules.at(-1)?.policyKey).toBe('acme_cancellations');
  });

  it('reports the file that decided, not the bundle', () => {
    expect(refund({ requestedAmountMinor: 600000 }).policyKey).toBe('acme_refunds');
    expect(cancel({ orderStatus: 'shipped' }).policyKey).toBe('acme_cancellations');
    expect(decide({ action: 'get_order' }).policyKey).toBe('acme_damaged_order');
  });

  it('changes version when any file changes', () => {
    const other = [...SOURCES.slice(0, 2), { key: 'x', yaml: `${SOURCES[2]!.yaml}\n# edit` }];
    expect(bundleVersionOf(other)).not.toBe(bundleVersionOf(SOURCES));
    expect(bundleVersionOf(SOURCES)).toBe(bundleVersionOf(SOURCES));
  });

  it('rejects a duplicate rule id across two files, naming both', () => {
    const dupe = {
      key: 'dupe',
      yaml: `key: dupe\nversion: "1"\ncurrency: INR\ndefault: deny\nrules:\n  - id: refund_standard\n    when: { action: { eq: x } }\n    decision: allow\n    reason: b\n`,
    };
    expect(() => compilePolicyBundle([...SOURCES, dupe])).toThrow(
      /duplicate rule id "refund_standard" in acme_refunds and dupe/,
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

describe('refund rules', () => {
  it('allows a small, in-window refund', () => {
    const r = refund();
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('refund_standard');
  });

  it('denies outside the seven day window', () => {
    const r = refund({ daysSinceDelivery: 8 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
  });

  it('allows on the last day of the window', () => {
    expect(refund({ daysSinceDelivery: 7 }).decision).toBe('allow');
  });

  it('denies an order that was never delivered', () => {
    const r = refund({ orderStatus: 'shipped' });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_order_not_delivered');
  });

  it('denies a second refund on a fully refunded order', () => {
    const r = refund({ fullyRefunded: true, refundedAmountMinor: 349900 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_already_refunded');
  });

  it('denies a request for more than what is left', () => {
    const r = refund({
      exceedsRemaining: true,
      requestedAmountMinor: 300000,
      refundedAmountMinor: 100000,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_exceeds_remaining');
  });

  it('allows a partial refund within the remaining balance', () => {
    const r = refund({
      refundedAmountMinor: 100000,
      requestedAmountMinor: 200000,
      exceedsRemaining: false,
    });
    expect(r.decision).toBe('allow');
  });

  it('denies a non-refundable category', () => {
    for (const itemCategory of ['gift_card', 'perishable', 'digital']) {
      expect(refund({ itemCategory }).ruleId).toBe('refund_non_refundable_category');
    }
  });

  it('requires approval exactly at the threshold', () => {
    const r = refund({
      requestedAmountMinor: 500000,
      orderTotalMinor: 900000,
      amountMinor: 900000,
    });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('refund_high_value_needs_approval');
  });

  it('allows just below the threshold', () => {
    expect(refund({ requestedAmountMinor: 499900 }).decision).toBe('allow');
  });

  it('denies before it asks for approval when the window has also expired', () => {
    const r = refund({ daysSinceDelivery: 30, requestedAmountMinor: 800000 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
  });

  it('falls back to the default when the requested amount is missing', () => {
    const r = decide({ action: 'create_refund', ...deliveredOrder, daysSinceDelivery: 4 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('requestedAmountMinor');
  });
});

describe('cancellation rules', () => {
  it('allows cancelling a placed order', () => {
    const r = cancel();
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('cancel_before_shipment');
  });

  it('allows cancelling a confirmed order', () => {
    expect(cancel({ orderStatus: 'confirmed' }).decision).toBe('allow');
  });

  it('denies cancelling a shipped order', () => {
    const r = cancel({ orderStatus: 'shipped' });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('cancel_after_shipment');
  });

  it('denies cancelling a delivered order', () => {
    expect(cancel({ orderStatus: 'delivered' }).ruleId).toBe('cancel_after_shipment');
  });

  it('requires approval at or above INR 10,000', () => {
    const r = cancel({ amountMinor: 1000000 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('cancel_high_value_needs_approval');
  });

  it('allows just below the approval threshold', () => {
    expect(cancel({ amountMinor: 999900 }).decision).toBe('allow');
  });

  it('falls back to the default when the order status is unknown', () => {
    const r = decide({ action: 'cancel_order', amountMinor: 100 });
    expect(r.decision).toBe('require_approval');
    expect(r.missingFacts).toContain('orderStatus');
  });
});

describe('the M0 damaged-order rules are unchanged by the bundle', () => {
  const damaged = {
    action: 'create_replacement',
    orderStatus: 'delivered',
    itemCategory: 'appliance',
    alreadyReplaced: false,
  } as const;

  it('still allows the H1 path', () => {
    const r = decide({ ...damaged, amountMinor: 349900, daysSinceDelivery: 4 });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('standard_replacement');
  });

  it('still requires approval at the threshold', () => {
    const r = decide({ ...damaged, amountMinor: 500000, daysSinceDelivery: 4 });
    expect(r.ruleId).toBe('high_value_needs_approval');
  });

  it('still denies outside the window', () => {
    const r = decide({ ...damaged, amountMinor: 219900, daysSinceDelivery: 12 });
    expect(r.ruleId).toBe('outside_return_window');
  });

  it('still allows reads and escalation for every action', () => {
    expect(decide({ action: 'get_order' }).decision).toBe('allow');
    expect(decide({ action: 'escalate_to_human' }).decision).toBe('allow');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePolicyBundle } from '../src/policy/compile.js';
import { evaluatePolicy } from '../src/policy/evaluate.js';
import type { PolicyFacts } from '../src/policy/types.js';

const DIR = join(import.meta.dirname, '../../../config/policies');

function source(name: string) {
  return { key: name, yaml: readFileSync(join(DIR, `${name}.yaml`), 'utf8') };
}

const bundle = compilePolicyBundle([
  source('refunds'),
  source('cancellations'),
  source('plan-changes'),
]);
const AT = new Date('2026-08-27T00:00:00.000Z');

function decide(facts: Partial<PolicyFacts> & { action: string }) {
  return evaluatePolicy(bundle, { channel: 'web', ...facts }, AT);
}

function refund(overrides: Partial<PolicyFacts> = {}) {
  return decide({
    action: 'create_refund',
    amountMinor: 349900,
    currency: 'INR',
    remainingRefundableMinor: 349900,
    exceedsRefundable: false,
    daysSinceCharge: 5,
    ...overrides,
  });
}

describe('money-ops bundle structure', () => {
  it('checks files in order and defaults to require_approval', () => {
    expect(bundle.sources.map((s) => s.key)).toEqual(['refunds', 'cancellations', 'plan_changes']);
    expect(bundle.default).toBe('require_approval');
    expect(bundle.rules.map((r) => r.id)).toEqual([
      'reads_always_allowed',
      'escalation_always_allowed',
      'ticket_always_allowed',
      'refund_exceeds_refundable',
      'refund_outside_window',
      'refund_high_value',
      'refund_standard',
      'cancel_unpaid_immediate',
      'cancel_allow',
      'plan_large_credit',
      'plan_allow',
    ]);
  });

  it('records the deciding file and version on every result', () => {
    expect(refund().policyKey).toBe('refunds');
    expect(refund().policyVersion).toBe('1.0.0');
    expect(decide({ action: 'cancel_subscription', subscriptionStatus: 'active' }).policyKey).toBe(
      'cancellations',
    );
    expect(decide({ action: 'change_plan', prorationCreditMinor: 10 }).policyKey).toBe(
      'plan_changes',
    );
  });

  it('sends an unknown action to the require-approval default', () => {
    const r = decide({ action: 'delete_everything' });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('default');
  });
});

describe('refunds.yaml', () => {
  it('allows a standard in-window refund', () => {
    const r = refund();
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('refund_standard');
    expect(r.factsUsed).toMatchObject({ action: 'create_refund', daysSinceCharge: 5 });
  });

  it('denies a refund above the remaining refundable amount', () => {
    const r = refund({
      amountMinor: 349900,
      remainingRefundableMinor: 249900,
      exceedsRefundable: true,
    });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_exceeds_refundable');
  });

  it('denies a refund outside the 30-day window', () => {
    const r = refund({ daysSinceCharge: 31 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
  });

  it('allows on day 30 and denies on day 31', () => {
    expect(refund({ daysSinceCharge: 30 }).decision).toBe('allow');
    expect(refund({ daysSinceCharge: 31 }).ruleId).toBe('refund_outside_window');
  });

  it('requires approval at the high-value threshold', () => {
    const r = refund({ amountMinor: 500000 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('refund_high_value');
  });

  it('allows just below the high-value threshold', () => {
    expect(refund({ amountMinor: 499999 }).decision).toBe('allow');
  });

  it('denies before asking for approval when the window has also expired', () => {
    const r = refund({ daysSinceCharge: 45, amountMinor: 800000 });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_outside_window');
  });

  it('checks exceeds-refundable before the window', () => {
    const r = refund({ daysSinceCharge: 45, exceedsRefundable: true });
    expect(r.decision).toBe('deny');
    expect(r.ruleId).toBe('refund_exceeds_refundable');
  });
});

describe('cancellations.yaml', () => {
  it('requires approval for an unpaid subscription', () => {
    const r = decide({ action: 'cancel_subscription', subscriptionStatus: 'unpaid' });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('cancel_unpaid_immediate');
  });

  it('allows a standard cancellation', () => {
    const r = decide({ action: 'cancel_subscription', subscriptionStatus: 'active' });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('cancel_allow');
  });
});

describe('plan-changes.yaml', () => {
  it('requires approval for a large proration credit', () => {
    const r = decide({ action: 'change_plan', prorationCreditMinor: 200000 });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('plan_large_credit');
  });

  it('allows a standard plan change', () => {
    const r = decide({ action: 'change_plan', prorationCreditMinor: 50000 });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('plan_allow');
  });

  it('allows when no proration credit was quoted', () => {
    const r = decide({ action: 'change_plan' });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('plan_allow');
  });
});

describe('money-ops missing facts fall closed', () => {
  it('absent amount and window facts fall to require_approval, not through', () => {
    const r = decide({
      action: 'create_refund',
      currency: 'INR',
      remainingRefundableMinor: 349900,
      exceedsRefundable: false,
    });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('amountMinor');
    expect(r.missingFacts).toContain('daysSinceCharge');
  });

  it('an absent amountMinor never matches the high-value rule', () => {
    const r = decide({
      action: 'create_refund',
      currency: 'INR',
      remainingRefundableMinor: 349900,
      exceedsRefundable: false,
    });
    expect(r.ruleId).not.toBe('refund_high_value');
  });

  it('an absent daysSinceCharge falls to require_approval', () => {
    const r = decide({
      action: 'create_refund',
      amountMinor: 349900,
      currency: 'INR',
      remainingRefundableMinor: 349900,
      exceedsRefundable: false,
    });
    expect(r.decision).toBe('require_approval');
    expect(r.ruleId).toBe('default');
    expect(r.missingFacts).toContain('daysSinceCharge');
  });

  it('cancel_allow matches on action alone, so an absent status still allows per spec', () => {
    const r = decide({ action: 'cancel_subscription' });
    expect(r.decision).toBe('allow');
    expect(r.ruleId).toBe('cancel_allow');
  });
});

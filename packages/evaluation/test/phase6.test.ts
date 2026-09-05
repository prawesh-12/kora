import { canonicalJson } from '@kora/core';
import { replayKey } from '@kora/tools';
import { describe, expect, it } from 'vitest';
import { loadBenchScenarios } from '../src/bench/runner.js';
import { buildReport, type ReplayOutcome } from '../src/bench/replay.js';
import {
  FaultInjectingBillingProvider,
  RecordingStubBillingProvider,
  runBillingChaos,
} from '../src/bench/billing-chaos.js';
import { chaosFailures } from '../src/bench/chaos.js';
import { runChecks, verifiedResolutionOf } from '../src/evaluate.js';
import { passingInput, policyCheck, snapshot } from './fixtures.js';

describe('recorded outputs are keyed by canonical JSON', () => {
  it('produces the same replay key regardless of input key order', () => {
    const a = replayKey('create_refund', { subscriptionId: 'sub_1S', amountMinor: 349900 });
    const b = replayKey('create_refund', { amountMinor: 349900, subscriptionId: 'sub_1S' });
    expect(a).toBe(b);
    expect(a).toBe(
      `create_refund:${canonicalJson({ amountMinor: 349900, subscriptionId: 'sub_1S' })}`,
    );
  });

  it('treats a retry with different input as a different action', () => {
    expect(replayKey('create_refund', { subscriptionId: 'sub_1S', amountMinor: 100 })).not.toBe(
      replayKey('create_refund', { subscriptionId: 'sub_1S', amountMinor: 200 }),
    );
  });

  it('keys Stripe-shaped recorded outputs the same way', () => {
    const input = {
      subscriptionId: 'sub_1S',
      invoiceId: 'in_1S',
      amountMinor: 349900,
      reason: 'requested_by_customer' as const,
    };
    expect(replayKey('create_refund', input)).toBe(
      `create_refund:${canonicalJson({ amountMinor: 349900, invoiceId: 'in_1S', reason: 'requested_by_customer', subscriptionId: 'sub_1S' })}`,
    );
  });
});

describe('the honest resolution metric', () => {
  function deniedRefundInput() {
    const input = passingInput();
    const read = input.trace.toolExecutions.find((e) => e.toolName === 'get_subscription');
    input.trace.run.intent = 'REFUND_REQUEST';
    input.trace.toolExecutions = read ? [read] : [];
    input.trace.policyChecks = [
      policyCheck({
        action: 'create_refund',
        decision: 'deny',
        ruleId: 'refund_outside_window',
        reason: 'Refunds are available for 30 days from the payment date',
      }) as never,
    ];
    input.trace.conversation.messages = [
      { ...input.trace.conversation.messages[0]!, content: 'Please refund subscription sub_1S.' },
      {
        ...input.trace.conversation.messages[1]!,
        content: 'I cannot refund this payment: refunds are available for 30 days.',
      },
    ] as never;
    input.externalState = snapshot(0);
    return input;
  }

  it('lets a correct denial pass without counting it as a resolution', () => {
    const input = deniedRefundInput();
    const checks = runChecks(input);
    expect(checks.find((c) => c.id === 'outcome_achieved')?.verdict).toBe('MET');
    expect(checks.find((c) => c.id === 'policy_compliance')?.verdict).toBe('MET');
    expect(verifiedResolutionOf(input.trace, checks)).toBe(false);
  });

  it('never counts a handover as a resolution', () => {
    const input = passingInput();
    input.trace.run.intent = 'OUT_OF_SCOPE';
    input.trace.run.outcome = 'escalated';
    input.trace.run.finalState = 'NEEDS_HUMAN';
    expect(verifiedResolutionOf(input.trace, runChecks(input))).toBe(false);
  });

  it('still counts a verified write as a resolution', () => {
    const input = passingInput();
    expect(verifiedResolutionOf(input.trace, runChecks(input))).toBe(true);
  });
});

describe('chaos money invariants', () => {
  const clean = {
    pass: 1,
    runs: 12,
    duplicateSideEffects: 0,
    forbiddenActions: 0,
    stuckRuns: 0,
    unverifiedClaims: 0,
    resolutionRate: 0.25,
    complete: true,
  };

  it('reports no failures when every invariant holds', () => {
    expect(chaosFailures([clean])).toEqual([]);
  });

  it('reports each broken invariant separately', () => {
    const problems = chaosFailures([
      { ...clean, duplicateSideEffects: 1, unverifiedClaims: 2 },
      { ...clean, pass: 2, forbiddenActions: 1, stuckRuns: 1 },
      { ...clean, pass: 3, complete: false },
    ]);
    expect(problems).toHaveLength(5);
    expect(problems.some((p) => p.includes('duplicate side effect'))).toBe(true);
    expect(problems.some((p) => p.includes('after a deny'))).toBe(true);
    expect(problems.some((p) => p.includes('non-terminal'))).toBe(true);
    expect(problems.some((p) => p.includes('unverified action'))).toBe(true);
    expect(problems.some((p) => p.includes('did not finish'))).toBe(true);
  });
});

describe('self-replay', () => {
  function outcome(over: Partial<ReplayOutcome> = {}): ReplayOutcome {
    return {
      runId: 'run_1',
      fromVerified: true,
      againstVerified: true,
      fromCompliant: true,
      againstCompliant: true,
      fromEscalated: false,
      againstEscalated: false,
      fromDurationMs: 1000,
      againstDurationMs: 1000,
      fromCostUsdMicros: 100,
      againstCostUsdMicros: 100,
      summary: 'unchanged',
      ...over,
    };
  }

  it('produces an empty diff when nothing changed', () => {
    const report = buildReport([outcome(), outcome({ runId: 'run_2' })], []);
    expect(report.regressions).toEqual([]);
    expect(report.compared).toBe(2);
  });

  it('flags a lost verification as a regression', () => {
    const report = buildReport([outcome({ againstVerified: false })], []);
    expect(report.regressions).toHaveLength(1);
  });
});

describe('chaos at the billing provider boundary', () => {
  const refundInput = {
    invoiceId: 'in_1S',
    chargeId: 'ch_1S',
    amountMinor: 349900,
    reason: 'requested_by_customer' as const,
  };

  it('passes everything through at a zero fault rate', async () => {
    const stub = new RecordingStubBillingProvider();
    const provider = new FaultInjectingBillingProvider(stub, { rate: 0 });
    const report = await runBillingChaos({
      provider,
      stub,
      attempts: [
        { input: refundInput, idempotencyKey: 'key_1' },
        { input: refundInput, idempotencyKey: 'key_2' },
      ],
    });
    expect(report).toMatchObject({
      attempts: 2,
      faultsInjected: 0,
      storedRefunds: 2,
      duplicateRefunds: 0,
      unverifiedClaims: 0,
    });
  });

  it('creates no duplicate refund when the same key is retried under faults', async () => {
    const stub = new RecordingStubBillingProvider();
    const values = [0.9, 0.1, 0, 0.9, 0.1, 0, 0.9, 0.1, 0];
    let i = 0;
    const provider = new FaultInjectingBillingProvider(stub, {
      rate: 0.5,
      faults: ['500'],
      random: () => values[i++ % values.length] ?? 0,
    });
    const report = await runBillingChaos({
      provider,
      stub,
      attempts: Array.from({ length: 6 }, () => ({
        input: refundInput,
        idempotencyKey: 'key_same',
      })),
    });
    expect(report.faultsInjected).toBeGreaterThan(0);
    expect(report.storedRefunds).toBe(1);
    expect(report.duplicateRefunds).toBe(0);
  });

  it('never claims a pending refund as success', async () => {
    const stub = new RecordingStubBillingProvider({ refundStatus: 'pending' });
    const provider = new FaultInjectingBillingProvider(stub, { rate: 0 });
    const report = await runBillingChaos({
      provider,
      stub,
      attempts: [{ input: refundInput, idempotencyKey: 'key_1' }],
    });
    expect(report.storedRefunds).toBe(1);
    expect(report.unverifiedClaims).toBe(1);
  });

  it('maps injected transport faults to the Kora error codes', async () => {
    const stub = new RecordingStubBillingProvider();
    for (const [fault, code] of [
      ['timeout', 'UPSTREAM_TIMEOUT'],
      ['500', 'UPSTREAM_5XX'],
    ] as const) {
      const provider = new FaultInjectingBillingProvider(stub, {
        rate: 1,
        faults: [fault],
        random: () => 0,
      });
      await expect(provider.createRefund(refundInput, 'key_x')).rejects.toMatchObject({ code });
    }
  });
});

describe('the benchmark suite', () => {
  const scenarios = loadBenchScenarios();

  it('is the money-ops suite: twelve acceptance scenarios then the injection set', () => {
    expect(scenarios.filter((s) => s.category === 'acceptance').map((s) => s.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
      'S9',
      'S10',
      'S11',
      'S12',
    ]);
    expect(new Set(scenarios.map((s) => s.category))).toEqual(
      new Set(['acceptance', 'prompt_injection']),
    );
    expect(scenarios).toHaveLength(22);
  });

  it('covers the four workflows and both failure paths', () => {
    const intents = new Set(
      scenarios.filter((s) => s.category === 'acceptance').map((s) => s.expect.intent),
    );
    expect(intents).toContain('REFUND_REQUEST');
    expect(intents).toContain('CANCEL_SUBSCRIPTION');
    expect(intents).toContain('CHANGE_PLAN');
    expect(intents).toContain('BILLING_QUESTION');

    const byId = new Map(scenarios.map((s) => [s.id, s]));
    // S11 is an unverified write, S12 an upstream failure. Both must escalate
    // and neither may be reported as a resolution.
    for (const id of ['S11', 'S12']) {
      expect(byId.get(id)?.expect.state).toBe('NEEDS_HUMAN');
      expect(byId.get(id)?.expect.evaluation?.verifiedResolution).toBe(false);
    }
  });

  it('gives every policy outcome a scenario', () => {
    const decisions = scenarios
      .filter((s) => s.category === 'acceptance')
      .map((s) => s.expect.policyDecision);
    expect(decisions).toContain('allow');
    expect(decisions).toContain('deny');
    expect(decisions).toContain('require_approval');
    expect(decisions).toContain(null);
  });

  it('keeps ten distinct injection attacks, none of which may write', () => {
    const injections = scenarios.filter((s) => s.category === 'prompt_injection');
    expect(injections).toHaveLength(10);
    expect(new Set(injections.map((s) => s.name)).size).toBe(10);
    for (const s of injections) {
      expect(s.expect.forbiddenTools).toContain('create_refund');
      expect(s.expect.policyDecision).toBe('deny');
      expect(s.expect.evaluation?.verifiedResolution).toBe(false);
    }
  });

  it('filters to one category', () => {
    expect(loadBenchScenarios('prompt_injection')).toHaveLength(10);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildReport,
  isNotReplayable,
  reconstructState,
  renderReplay,
  stratify,
  type ReplayOutcome,
} from '../src/bench/replay.js';
import { passingInput, toolExecution, withTrace } from './fixtures.js';

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
    againstDurationMs: 900,
    fromCostUsdMicros: 100,
    againstCostUsdMicros: 90,
    summary: 'unchanged',
    ...over,
  };
}

describe('point-in-time reconstruction', () => {
  it('rebuilds the subscription and the refund from the original tool outputs', () => {
    const state = reconstructState(passingInput().trace);
    expect(isNotReplayable(state)).toBe(false);
    if (isNotReplayable(state)) return;

    expect(state.subscriptions.sub_1S).toBeDefined();
    expect(state.refunds.re_1S?.status).toBe('succeeded');
    expect(Object.keys(state.toolOutputs).length).toBeGreaterThan(0);
  });

  it('refuses a run whose write output was never recorded', () => {
    const input = withTrace({
      toolExecutions: [
        toolExecution({
          id: 'tex_0',
          toolName: 'get_subscription',
          output: { id: 'sub_1S' },
          verified: null,
          verifyObserved: null,
        }),
        toolExecution({ output: null }),
      ],
    });
    const state = reconstructState(input.trace);
    expect(isNotReplayable(state)).toBe(true);
    if (isNotReplayable(state)) {
      expect(state.reason).toContain('create_refund');
    }
  });

  it('refuses a run whose get_subscription output was never recorded', () => {
    const input = withTrace({
      toolExecutions: [toolExecution({ toolName: 'get_subscription', output: {}, verified: null })],
    });
    expect(isNotReplayable(reconstructState(input.trace))).toBe(true);
  });

  it('refuses a run with no recorded intent', () => {
    const input = withTrace({ run: { ...passingInput().trace.run, intent: null } });
    const state = reconstructState(input.trace);
    expect(isNotReplayable(state)).toBe(true);
    if (isNotReplayable(state)) expect(state.reason).toContain('intent');
  });

  it('keys tool outputs by name and input, so a repeated call replays correctly', () => {
    const state = reconstructState(passingInput().trace);
    if (isNotReplayable(state)) throw new Error('should be replayable');
    const keys = Object.keys(state.toolOutputs);
    expect(keys.some((k) => k.startsWith('get_subscription:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('create_refund:'))).toBe(true);
  });
});

describe('stratified sampling', () => {
  const items = [
    ...Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, intent: 'BILLING_QUESTION' })),
    ...Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, intent: 'CANCEL_SUBSCRIPTION' })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, intent: 'REFUND_REQUEST' })),
  ];

  it('gives a rare intent real representation rather than its traffic share', () => {
    const picked = stratify(items, (i) => i.intent, 12);
    const counts = new Map<string, number>();
    for (const p of picked) counts.set(p.intent, (counts.get(p.intent) ?? 0) + 1);

    expect(picked).toHaveLength(12);
    // A random sample of this traffic would be almost all billing questions.
    expect(counts.get('REFUND_REQUEST')).toBeGreaterThanOrEqual(4);
    expect(counts.get('CANCEL_SUBSCRIPTION')).toBeGreaterThanOrEqual(4);
  });

  it('returns everything when the limit is not binding', () => {
    expect(stratify(items, (i) => i.intent, 500)).toHaveLength(items.length);
  });

  it('drains a small stratum without looping forever', () => {
    const picked = stratify(items, (i) => i.intent, 99);
    expect(picked.length).toBeLessThanOrEqual(items.length);
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
  });
});

describe('the report', () => {
  it('is empty for a self-replay against the identical version', () => {
    const report = buildReport([outcome(), outcome({ runId: 'run_2' })], []);
    expect(report.regressions).toEqual([]);
    expect(report.improvements).toEqual([]);
    expect(report.aggregate.verifiedResolution?.delta).toBe(0);
    expect(report.aggregate.policyCompliance?.delta).toBe(0);
  });

  it('counts a lost resolution as a regression', () => {
    const report = buildReport([outcome({ againstVerified: false })], []);
    expect(report.regressions).toHaveLength(1);
    expect(report.improvements).toHaveLength(0);
  });

  it('counts a lost compliance as a regression even when resolution improved', () => {
    const report = buildReport(
      [outcome({ fromVerified: false, againstVerified: true, againstCompliant: false })],
      [],
    );
    expect(report.regressions).toHaveLength(1);
  });

  it('counts a gained resolution as an improvement', () => {
    const report = buildReport([outcome({ fromVerified: false })], []);
    expect(report.improvements).toHaveLength(1);
    expect(report.regressions).toHaveLength(0);
  });

  it('never hides a run it could not replay', () => {
    const report = buildReport([outcome()], [{ runId: 'run_x', reason: 'no refund output' }]);
    expect(report.notReplayable).toHaveLength(1);
    expect(report.compared).toBe(1);
  });

  it('puts regressions above the aggregate in the rendered output', () => {
    const rendered = renderReplay(
      buildReport([outcome({ againstVerified: false, summary: 'lost the write' })], []),
    );
    expect(rendered.indexOf('REGRESSIONS')).toBeLessThan(rendered.indexOf('verifiedResolution'));
    expect(rendered).toContain('read these first');
  });

  it('says plainly when there are none', () => {
    expect(renderReplay(buildReport([outcome()], []))).toContain('No regressions.');
  });
});

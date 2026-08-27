import { describe, expect, it } from 'vitest';
import { agreementOf } from '../src/repositories/shadow-repo.js';
import { promotionGates } from '../src/repositories/promotion-repo.js';

const passing = {
  benchmarkPassed: true,
  benchmarkRunId: 'bench_1',
  replayRunId: 'replay_1',
  replayCompared: 500,
  replayVrrDelta: 0.04,
  regressions: [] as string[],
};

describe('promotion gates', () => {
  it('lets a clean version through', () => {
    expect(promotionGates(passing, [])).toEqual([]);
  });

  it('blocks a failing benchmark and names the gate that failed', () => {
    const blocked = promotionGates(
      { ...passing, benchmarkPassed: false, benchmarkFailedGates: ['policy compliance is 99.2%'] },
      [],
    );
    expect(blocked.map((b) => b.gate)).toEqual(['benchmark']);
    expect(blocked[0]?.reason).toContain('policy compliance');
  });

  it('blocks when no replay has been run', () => {
    const { replayRunId, ...withoutReplay } = passing;
    void replayRunId;
    expect(promotionGates(withoutReplay, []).map((b) => b.gate)).toEqual(['replay']);
  });

  it('blocks a replay too small to see a regression', () => {
    const blocked = promotionGates({ ...passing, replayCompared: 40 }, []);
    expect(blocked[0]?.reason).toContain('40 conversations');
  });

  it('blocks a replay that lost verified resolution', () => {
    const blocked = promotionGates({ ...passing, replayVrrDelta: -0.02 }, []);
    expect(blocked[0]?.gate).toBe('replay');
    expect(blocked[0]?.reason).toContain('regressed by 2.0 points');
  });

  it('blocks unreviewed regressions and lists them', () => {
    const blocked = promotionGates({ ...passing, regressions: ['run_a', 'run_b'] }, []);
    expect(blocked[0]?.gate).toBe('regressions');
    expect(blocked[0]?.reason).toContain('run_a');
  });

  it('lets a regression through only once it has been explicitly accepted', () => {
    const evidence = { ...passing, regressions: ['run_a'] };
    expect(promotionGates(evidence, [])).toHaveLength(1);
    expect(promotionGates(evidence, ['run_a'])).toEqual([]);
  });

  it('reports every failing gate at once, not just the first', () => {
    const blocked = promotionGates({ benchmarkPassed: false, regressions: ['run_a'] }, []);
    expect(blocked.map((b) => b.gate).sort()).toEqual(['benchmark', 'regressions', 'replay']);
  });
});

describe('shadow agreement', () => {
  const proposal = {
    tenantId: 't',
    conversationId: 'c',
    runId: 'r',
    proposedAction: 'create_refund',
    proposedAmountMinor: 200000,
  };

  it('matches when the action and the amount agree', () => {
    expect(agreementOf(proposal, { action: 'create_refund', amountMinor: 200000 })).toEqual({
      agreement: 'match',
      valueAtRiskMinor: 0,
    });
  });

  it('reports a different action, with the larger amount at risk', () => {
    const result = agreementOf(proposal, { action: 'create_replacement', amountMinor: 349900 });
    expect(result.agreement).toBe('action_differs');
    expect(result.valueAtRiskMinor).toBe(349900);
  });

  it('reports a different amount, with the gap at risk', () => {
    const result = agreementOf(proposal, { action: 'create_refund', amountMinor: 150000 });
    expect(result.agreement).toBe('amount_differs');
    expect(result.valueAtRiskMinor).toBe(50000);
  });

  it('never counts a missing human record as agreement', () => {
    expect(agreementOf(proposal, null).agreement).toBe('no_human_record');
    expect(agreementOf(proposal, { action: null, amountMinor: null }).agreement).toBe(
      'no_human_record',
    );
  });

  it('treats doing nothing as a real proposal, not a missing one', () => {
    const noAction = { ...proposal, proposedAction: null, proposedAmountMinor: null };
    expect(agreementOf(noAction, { action: 'create_refund', amountMinor: 200000 })).toMatchObject({
      agreement: 'action_differs',
      valueAtRiskMinor: 200000,
    });
  });
});

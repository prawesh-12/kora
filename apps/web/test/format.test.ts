import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  formatCostMicros,
  formatDuration,
  formatUsd,
  humanizeFailureDetail,
  truncateId,
} from '@/lib/ops/format';

describe('durations', () => {
  it('never renders a fake zero', () => {
    // Every step in the trace showed `0ms` because an unknown duration was
    // written as 0. An unknown duration has to look unknown.
    expect(formatDuration(null)).toBe(EMPTY);
    expect(formatDuration(undefined)).toBe(EMPTY);
    expect(formatDuration(0)).toBe('<1ms');
  });

  it('reads at every scale', () => {
    expect(formatDuration(61)).toBe('61ms');
    expect(formatDuration(1500)).toBe('1.50s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });
});

describe('cost', () => {
  it('distinguishes runs that dollars to four places collapses', () => {
    // 126 and 98 micro-USD are both `$0.0001`. That column carried no
    // information, which is the bug this format exists to fix.
    expect(formatCostMicros(126)).not.toBe(formatCostMicros(98));
    expect(formatCostMicros(126)).toBe('126µ$');
    expect(formatCostMicros(98)).toBe('98µ$');
  });

  it('switches to dollars once dollars are readable', () => {
    expect(formatCostMicros(2_500_000)).toBe('$2.50');
  });

  it('says nothing rather than zero when there is no value', () => {
    expect(formatCostMicros(null)).toBe(EMPTY);
    expect(formatCostMicros(0)).toBe('0');
  });

  it('aggregates in dollars', () => {
    expect(formatUsd(12_500_000)).toBe('$12.50');
    expect(formatUsd(400)).toBe('<$0.01');
  });
});

describe('ids', () => {
  it('truncates for a table and keeps the full value for a title', () => {
    expect(truncateId('run_01M11PSMKNK43XYFPWFDR8FFMK')).toBe('run_01M1…');
    expect(truncateId('short')).toBe('short');
    expect(truncateId(null)).toBe(EMPTY);
  });
});

describe('the failure detail', () => {
  it('turns the engine talking to itself into a sentence', () => {
    expect(
      humanizeFailureDetail('insufficient facts: exceedsRemaining, requestedAmountMinor'),
    ).toBe('missing order facts');
  });

  it('humanizes an intent enum', () => {
    expect(humanizeFailureDetail('OUT_OF_SCOPE')).toBe('out of scope');
  });

  it('leaves a detail that already reads as one alone', () => {
    expect(humanizeFailureDetail('get_order / upstream_4xx')).toBe('get_order / upstream_4xx');
  });
});

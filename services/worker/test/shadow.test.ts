import { agreementOf, closeDb, sql } from '@kora/db';
import { afterAll, describe, expect, it } from 'vitest';
import { shadowCompareJob } from '../src/jobs/shadow-compare.js';

afterAll(closeDb);

describe('agreement', () => {
  const proposal = {
    tenantId: 't',
    conversationId: 'c',
    runId: 'r',
    proposedAction: 'create_refund',
    proposedAmountMinor: 349_900,
  };

  it('matches when the action and the amount are the same', () => {
    expect(agreementOf(proposal, { action: 'create_refund', amountMinor: 349_900 })).toEqual({
      agreement: 'match',
      valueAtRiskMinor: 0,
    });
  });

  it('reports the larger amount at risk when the action differs', () => {
    const r = agreementOf(proposal, { action: 'create_replacement', amountMinor: 500_000 });
    expect(r.agreement).toBe('action_differs');
    expect(r.valueAtRiskMinor).toBe(500_000);
  });

  it('reports the gap when only the amount differs', () => {
    const r = agreementOf(proposal, { action: 'create_refund', amountMinor: 300_000 });
    expect(r.agreement).toBe('amount_differs');
    expect(r.valueAtRiskMinor).toBe(49_900);
  });

  it('does not compare amounts on a replacement, which carries none', () => {
    // Acme stores no amount on a replacement, so a proposal that also carries no
    // amount agrees. Pricing the proposal but not the record would report every
    // matched replacement as a disagreement over nothing.
    const noAmount = {
      ...proposal,
      proposedAction: 'create_replacement',
      proposedAmountMinor: null,
    };
    expect(
      agreementOf(noAmount, { action: 'create_replacement', amountMinor: null }).agreement,
    ).toBe('match');
  });

  it('skips rather than agreeing when no person handled the case', () => {
    // Counting this as agreement would make an untouched queue look like a
    // perfect agent.
    expect(agreementOf(proposal, null).agreement).toBe('no_human_record');
    expect(agreementOf(proposal, { action: null, amountMinor: null }).agreement).toBe(
      'no_human_record',
    );
  });
});

describe('the shadow comparison job', () => {
  it('records one row per finished shadow run and no more on a second pass', async () => {
    const before = await countComparisons();
    await shadowCompareJob();
    const after = await countComparisons();

    await shadowCompareJob();
    expect(await countComparisons(), 'a second pass re-compared runs it had already done').toBe(
      after,
    );
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('ignores runs that were not in shadow mode', async () => {
    const rows = await sql()<{ n: string }[]>`
      SELECT count(*) AS n FROM shadow_comparisons s
      JOIN agent_runs r ON r.id = s.run_id
      WHERE r.deployment_mode <> 'shadow'`;
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });
});

async function countComparisons(): Promise<number> {
  const rows = await sql()<{ n: string }[]>`SELECT count(*) AS n FROM shadow_comparisons`;
  return Number(rows[0]?.n ?? 0);
}

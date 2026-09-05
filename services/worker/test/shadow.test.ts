import {
  agreementOf,
  closeDb,
  disagreementsByValue,
  matchedCount,
  skippedCount,
  sql,
} from '@kora/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    // Pricing the proposal when the record carries no amount would report every
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

describe('the disagreements list', () => {
  const TENANT = 'ten_shadow_list_test';

  beforeAll(async () => {
    await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Shadow list')
                ON CONFLICT (id) DO NOTHING`;
    await sql()`INSERT INTO conversations (id, tenant_id, channel, state)
                VALUES ('conv_shadow_list', ${TENANT}, 'web', 'NEW')`;
    await sql()`INSERT INTO agent_runs (id, tenant_id, conversation_id, trace_id, agent_config_version)
                VALUES ('run_shadow_list', ${TENANT}, 'conv_shadow_list', 'tr_shadow_list', 'v1')`;

    const row = (id: string, agreement: string, value: number) => sql()`
      INSERT INTO shadow_comparisons
        (id, tenant_id, conversation_id, run_id, proposed_action, actual_action, agreement, value_at_risk_minor)
      VALUES (${id}, ${TENANT}, 'conv_shadow_list', 'run_shadow_list',
              'create_refund', 'create_refund', ${agreement}, ${value})`;

    await row('ev_sl_1', 'no_human_record', 0);
    await row('ev_sl_2', 'no_human_record', 0);
    await row('ev_sl_3', 'match', 0);
    await row('ev_sl_4', 'amount_differs', 250_000);
    await row('ev_sl_5', 'action_differs', 900_000);
  });

  afterAll(async () => {
    await sql()`DELETE FROM shadow_comparisons WHERE tenant_id = ${TENANT}`;
    await sql()`DELETE FROM agent_runs WHERE tenant_id = ${TENANT}`;
    await sql()`DELETE FROM conversations WHERE tenant_id = ${TENANT}`;
    await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  });

  it('never lists a run nobody handled as a disagreement', async () => {
    const rows = await disagreementsByValue(TENANT);

    expect(rows.every((r) => r.agreement !== 'no_human_record')).toBe(true);
    expect(rows.every((r) => r.agreement !== 'match')).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('ranks by what the disagreement would have cost', async () => {
    const rows = await disagreementsByValue(TENANT);
    expect(rows.map((r) => r.valueAtRiskMinor)).toEqual([900_000, 250_000]);
  });

  it('counts the skipped runs separately, because they qualify the rate', async () => {
    expect(await skippedCount(TENANT)).toBe(2);
    expect(await matchedCount(TENANT)).toBe(1);
  });
});

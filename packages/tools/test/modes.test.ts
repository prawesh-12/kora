import { sql } from '@kora/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { capExceeded } from '../src/caps.js';
import { executeTool } from '../src/pipeline.js';
import {
  ORDER_9832,
  TENANT,
  acmeRequestLog,
  acmeUp,
  argsFor,
  cleanupTenant,
  ensureTenant,
  newRun,
  resetAcme,
} from './helpers.js';

const REPLACEMENT = {
  orderId: '9832',
  items: [{ sku: 'SKU-CM-01', quantity: 1 }],
  reason: 'damaged' as const,
};

beforeAll(async () => {
  if (!(await acmeUp())) {
    throw new Error('the acme mock commerce service is not running on ACME_BASE_URL');
  }
  await ensureTenant();
});

beforeEach(async () => {
  await resetAcme(['9832']);
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
});

afterAll(cleanupTenant);

describe('shadow mode', () => {
  it('returns simulated for a write and sends nothing to acme', async () => {
    const before = (await acmeRequestLog('/replacements')).length;
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('create_replacement', REPLACEMENT, run, conversationId, {
        deploymentMode: 'shadow',
      }),
    );

    expect(outcome.status).toBe('simulated');
    expect((await acmeRequestLog('/replacements')).length).toBe(before);
  });

  it('still writes the policy check, so the proposal can be compared', async () => {
    const { run, conversationId } = await newRun();

    await executeTool(
      argsFor('create_replacement', REPLACEMENT, run, conversationId, {
        deploymentMode: 'shadow',
      }),
    );

    const rows = await sql()<{ decision: string }[]>`
      SELECT decision FROM policy_checks WHERE run_id = ${run.runId} AND action = 'create_replacement'`;
    expect(rows).toHaveLength(1);
  });

  it('still stops for approval, because that is the proposal worth comparing', async () => {
    const before = (await acmeRequestLog('/replacements')).length;
    const { run, conversationId } = await newRun();

    // 9833 is INR 8,999, above the approval threshold.
    const outcome = await executeTool(
      argsFor('create_replacement', { ...REPLACEMENT, orderId: '9833' }, run, conversationId, {
        deploymentMode: 'shadow',
        gathered: { order: { ...ORDER_9832, id: '9833', totalAmountMinor: 899_900 } },
      }),
    );

    // Turning this into a silent simulated success would say the agent resolved
    // a case that a person actually had to sign off.
    expect(outcome.status).toBe('awaiting_approval');
    expect((await acmeRequestLog('/replacements')).length).toBe(before);
  });

  it('lets reads through, because shadow mode reads the real business system', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('get_order', { orderId: '9832' }, run, conversationId, {
        deploymentMode: 'shadow',
      }),
    );

    expect(outcome.status).toBe('ok');
  });
});

describe('replay', () => {
  it('serves a read from the recorded output instead of calling acme', async () => {
    const before = (await acmeRequestLog('/orders/9832')).length;
    const { run, conversationId } = await newRun();
    const recorded = { id: '9832', status: 'from-the-past' };

    const outcome = await executeTool(
      argsFor('get_order', { orderId: '9832' }, run, conversationId, {
        deploymentMode: 'simulation',
        recordedOutputs: { 'get_order:{"orderId":"9832"}': recorded },
      }),
    );

    expect(outcome.status).toBe('simulated');
    expect((outcome as { output: unknown }).output).toEqual(recorded);
    expect((await acmeRequestLog('/orders/9832')).length).toBe(before);
  });

  it('refuses a read the original run never made rather than answering from today', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('get_order', { orderId: '9833' }, run, conversationId, {
        deploymentMode: 'simulation',
        recordedOutputs: { 'get_order:{"orderId":"9832"}': { id: '9832' } },
      }),
    );

    expect(outcome.status).toBe('failed');
    expect((outcome as { code: string }).code).toBe('REPLAY_GAP');
  });

  it('evaluates policy on replay, so a denied action stays denied', async () => {
    const { run, conversationId } = await newRun();

    // 9834 was delivered twelve days ago, outside the seven-day window.
    const outcome = await executeTool(
      argsFor('create_replacement', { ...REPLACEMENT, orderId: '9834' }, run, conversationId, {
        deploymentMode: 'simulation',
        gathered: {
          order: {
            ...ORDER_9832,
            id: '9834',
            totalAmountMinor: 219_900,
            deliveredAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
          },
        },
        recordedOutputs: {},
      }),
    );

    expect(outcome.status).toBe('denied');
  });
});

describe('limited mode caps', () => {
  it('escalates rather than failing when the daily action cap is used up', () => {
    const reason = capExceeded(
      { maxActionsPerDay: 2, maxValueMinorPerAction: null, maxValueMinorPerDay: null },
      { actions: 2, valueMinor: 0 },
      100,
    );
    expect(reason).toMatch(/daily limit of 2 actions/);
  });

  it('blocks a single action worth more than the per-action cap', () => {
    const reason = capExceeded(
      { maxActionsPerDay: null, maxValueMinorPerAction: 500_000, maxValueMinorPerDay: null },
      { actions: 0, valueMinor: 0 },
      899_900,
    );
    expect(reason).toMatch(/per-action limit/);
  });

  it('counts the proposed action against the daily value cap', () => {
    const caps = {
      maxActionsPerDay: null,
      maxValueMinorPerAction: null,
      maxValueMinorPerDay: 500_000,
    };
    expect(capExceeded(caps, { actions: 3, valueMinor: 400_000 }, 150_000)).toMatch(/daily value/);
    expect(capExceeded(caps, { actions: 3, valueMinor: 400_000 }, 50_000)).toBeNull();
  });

  it('lets everything through when no cap is set', () => {
    const none = {
      maxActionsPerDay: null,
      maxValueMinorPerAction: null,
      maxValueMinorPerDay: null,
    };
    expect(capExceeded(none, { actions: 9999, valueMinor: 9_999_999 }, 9_999_999)).toBeNull();
  });

  it('sends a capped write to a person instead of executing it', async () => {
    const before = (await acmeRequestLog('/replacements')).length;
    await sql()`UPDATE tenants SET max_actions_per_day = 0 WHERE id = ${TENANT}`;
    const { run, conversationId } = await newRun();

    try {
      const outcome = await executeTool(
        argsFor('create_replacement', REPLACEMENT, run, conversationId, {
          deploymentMode: 'limited',
        }),
      );

      expect(outcome.status).toBe('awaiting_approval');
      expect((outcome as { reason: string }).reason).toMatch(/daily limit/);
      expect((await acmeRequestLog('/replacements')).length).toBe(before);
    } finally {
      await sql()`UPDATE tenants SET max_actions_per_day = NULL WHERE id = ${TENANT}`;
    }
  });

  it('runs normally when the caps leave room', async () => {
    await sql()`UPDATE tenants SET max_actions_per_day = 50, max_value_minor_per_action = 1000000
                WHERE id = ${TENANT}`;
    const { run, conversationId } = await newRun();

    try {
      const outcome = await executeTool(
        argsFor('create_replacement', REPLACEMENT, run, conversationId, {
          deploymentMode: 'limited',
        }),
      );
      expect(outcome.status).toBe('ok');
    } finally {
      await sql()`UPDATE tenants SET max_actions_per_day = NULL, max_value_minor_per_action = NULL
                  WHERE id = ${TENANT}`;
    }
  });
});

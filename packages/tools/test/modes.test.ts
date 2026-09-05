import { sql } from '@kora/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { capExceeded } from '../src/caps.js';
import { executeTool } from '../src/pipeline.js';
import {
  CHARGE,
  OLD_CHARGE,
  SUBSCRIPTION,
  TENANT,
  argsFor,
  cleanupTenant,
  ensureTenant,
  installFakeBilling,
  newRun,
  resetBilling,
  resetRunState,
} from './helpers.js';
import type { FakeBillingProvider } from './fake-billing.js';

const REFUND = {
  subscriptionId: SUBSCRIPTION.id,
  invoiceId: 'in_1S',
  amountMinor: 200_000,
  reason: 'requested_by_customer' as const,
};

let billing: FakeBillingProvider;

beforeAll(ensureTenant);

beforeEach(async () => {
  billing = installFakeBilling();
  await resetRunState();
});

afterEach(resetBilling);

afterAll(cleanupTenant);

describe('shadow mode', () => {
  it('returns simulated for a write and sends nothing to the billing provider', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('create_refund', REFUND, run, conversationId, { deploymentMode: 'shadow' }),
    );

    expect(outcome.status).toBe('simulated');
    expect(billing.calls).toHaveLength(0);
  });

  it('still writes the policy check, so the proposal can be compared', async () => {
    const { run, conversationId } = await newRun();

    await executeTool(
      argsFor('create_refund', REFUND, run, conversationId, { deploymentMode: 'shadow' }),
    );

    const rows = await sql()<{ decision: string }[]>`
      SELECT decision FROM policy_checks WHERE run_id = ${run.runId} AND action = 'create_refund'`;
    expect(rows).toHaveLength(1);
  });

  it('still stops for approval, because that is the proposal worth comparing', async () => {
    const { run, conversationId } = await newRun();

    // INR 6,000 is above the high-value threshold a person has to sign off.
    const outcome = await executeTool(
      argsFor('create_refund', { ...REFUND, amountMinor: 600_000 }, run, conversationId, {
        deploymentMode: 'shadow',
        gathered: {
          subscription: SUBSCRIPTION,
          charge: { ...CHARGE, remainingRefundable: { amountMinor: 1_200_000, currency: 'INR' } },
        },
      }),
    );

    // Turning this into a silent simulated success would say the agent resolved
    // a case that a person actually had to sign off.
    expect(outcome.status).toBe('awaiting_approval');
    expect(billing.calls).toHaveLength(0);
  });

  it('lets reads through, because shadow mode reads the real billing records', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId, {
        deploymentMode: 'shadow',
      }),
    );

    expect(outcome.status).toBe('ok');
  });
});

describe('replay', () => {
  it('serves a read from the recorded output instead of calling the provider', async () => {
    const { run, conversationId } = await newRun();
    const recorded = { id: SUBSCRIPTION.id, status: 'from-the-past' };

    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: SUBSCRIPTION.id }, run, conversationId, {
        deploymentMode: 'simulation',
        recordedOutputs: { [`get_subscription:{"subscriptionId":"${SUBSCRIPTION.id}"}`]: recorded },
      }),
    );

    expect(outcome.status).toBe('simulated');
    expect((outcome as { output: unknown }).output).toEqual(recorded);
    expect(billing.calls).toHaveLength(0);
  });

  it('refuses a read the original run never made rather than answering from today', async () => {
    const { run, conversationId } = await newRun();

    const outcome = await executeTool(
      argsFor('get_subscription', { subscriptionId: 'sub_2S' }, run, conversationId, {
        deploymentMode: 'simulation',
        recordedOutputs: {
          [`get_subscription:{"subscriptionId":"${SUBSCRIPTION.id}"}`]: { id: SUBSCRIPTION.id },
        },
      }),
    );

    expect(outcome.status).toBe('failed');
    expect((outcome as { code: string }).code).toBe('REPLAY_GAP');
  });

  it('evaluates policy on replay, so a denied action stays denied', async () => {
    const { run, conversationId } = await newRun();

    // The charge behind in_3S is 45 days old, outside the 30-day refund window.
    const outcome = await executeTool(
      argsFor('create_refund', { ...REFUND, invoiceId: 'in_3S' }, run, conversationId, {
        deploymentMode: 'simulation',
        gathered: { subscription: SUBSCRIPTION, charge: OLD_CHARGE },
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
    await sql()`UPDATE tenants SET max_actions_per_day = 0 WHERE id = ${TENANT}`;
    const { run, conversationId } = await newRun();

    try {
      const outcome = await executeTool(
        argsFor('create_refund', REFUND, run, conversationId, { deploymentMode: 'limited' }),
      );

      expect(outcome.status).toBe('awaiting_approval');
      expect((outcome as { reason: string }).reason).toMatch(/daily limit/);
      expect(billing.calls).toHaveLength(0);
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
        argsFor('create_refund', REFUND, run, conversationId, { deploymentMode: 'limited' }),
      );
      expect(outcome.status).toBe('ok');
    } finally {
      await sql()`UPDATE tenants SET max_actions_per_day = NULL, max_value_minor_per_action = NULL
                  WHERE id = ${TENANT}`;
    }
  });
});

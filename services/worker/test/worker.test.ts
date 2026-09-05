import { now, serverEnv } from '@kora/core';
import { closeDb, emit, sql, withTenant } from '@kora/db';
import { setBillingProvider, setTenantStripeKey } from '@kora/tools';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wireEnqueue } from '../src/enqueue.js';
import { REPEATABLE } from '../src/queues.js';
import { type WorkerHandle, startWorker } from '../src/index.js';
import { stubBilling } from './support/billing.js';

const TENANT = serverEnv().KORA_TENANT_ID;

let handle: WorkerHandle | null = null;
const conversationIds: string[] = [];

async function drainQueues(): Promise<void> {
  if (!handle) return;
  for (const queue of Object.values(handle.queues)) await queue.drain(true);
}

/** Waits for a condition rather than sleeping a fixed time. */
async function until(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function runOneTurn(): Promise<{ runId: string; conversationId: string }> {
  const { runAgentTurn } = await import('@kora/ai');
  setBillingProvider(stubBilling());

  const conversation = await withTenant(TENANT).conversations.create({
    externalCustomerId: 'cus_014',
  });
  conversationIds.push(conversation.id);

  const result = await runAgentTurn({
    tenantId: TENANT,
    conversationId: conversation.id,
    message: 'Please refund my last payment on subscription sub_recent.',
    deploymentMode: 'full',
  });
  return { runId: result.runId, conversationId: conversation.id };
}

beforeAll(async () => {
  await setTenantStripeKey(TENANT, 'sk_test_worker');
  handle = await startWorker();
  await drainQueues();
});

beforeEach(async () => {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
});

afterAll(async () => {
  setBillingProvider(null);
  await handle?.stop();
  if (conversationIds.length > 0) {
    await sql()`DELETE FROM conversations WHERE id IN ${sql()(conversationIds)}`;
  }
  await sql()`DELETE FROM events WHERE tenant_id = ${TENANT}`;
  await closeDb();
});

describe('the worker evaluates a finished run', () => {
  it('produces exactly one evaluation from the run.finished event', async () => {
    const { runId } = await runOneTurn();

    const evaluated = await until(async () => {
      const rows = await sql()`SELECT id FROM evaluations WHERE run_id = ${runId}`;
      return rows.length === 1;
    });

    expect(evaluated, 'the worker never evaluated the run').toBe(true);
    const rows = await sql()<{ verified_resolution: boolean }[]>`
      SELECT verified_resolution FROM evaluations WHERE run_id = ${runId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verified_resolution).toBe(true);
  });

  it('emits evaluation.completed once the evaluation is written', async () => {
    const { runId } = await runOneTurn();

    const emitted = await until(async () => {
      const rows = await sql()`
        SELECT id FROM events WHERE run_id = ${runId} AND type = 'evaluation.completed'`;
      return rows.length === 1;
    });
    expect(emitted).toBe(true);
  });

  it('still produces one evaluation when the job is re-delivered', async () => {
    const { runId, conversationId } = await runOneTurn();

    await until(async () => {
      const rows = await sql()`SELECT id FROM evaluations WHERE run_id = ${runId}`;
      return rows.length === 1;
    });

    // What BullMQ does after a worker is killed mid-job. `evaluations.run_id` is
    // unique, so the retry has to be a no-op rather than a second row.
    await emit('run.finished', {
      tenantId: TENANT,
      traceId: 'tr_redelivery',
      runId,
      conversationId,
      outcome: 'resolved_automatically',
      finalState: 'RESOLVED',
      occurredAt: now(),
    });

    await new Promise((r) => setTimeout(r, 3000));
    const rows = await sql()`SELECT id FROM evaluations WHERE run_id = ${runId}`;
    expect(rows).toHaveLength(1);
  });
});

describe('the catch-up path', () => {
  it('replays an event whose enqueue failed', async () => {
    const { runId, conversationId } = await runOneTurn();
    await until(async () => {
      const rows = await sql()`SELECT id FROM evaluations WHERE run_id = ${runId}`;
      return rows.length === 1;
    });

    // An event written while Redis was down: the row exists, the job never did.
    const { setEnqueue } = await import('@kora/db');
    setEnqueue(async () => {
      throw new Error('redis down');
    });
    const stranded = await emit('run.finished', {
      tenantId: TENANT,
      traceId: 'tr_stranded',
      runId,
      conversationId,
      outcome: 'resolved_automatically',
      finalState: 'RESOLVED',
      occurredAt: now(),
    });
    expect(stranded.enqueued).toBe(false);

    wireEnqueue(handle!.queues);
    const { replayPendingEventsJob } = await import('../src/jobs/replay-pending-events.js');
    await replayPendingEventsJob(handle!.queues);

    const rows = await sql()<{ enqueued: boolean }[]>`
      SELECT enqueued FROM events WHERE id = ${stranded.eventId}`;
    expect(rows[0]?.enqueued).toBe(true);
  });
});

describe('repeatable jobs', () => {
  it('registers a scheduler for every maintenance job', async () => {
    // Derived from REPEATABLE rather than listed here, so adding a job cannot
    // leave a stale expectation that passes for the wrong reason.
    const expected = REPEATABLE.filter((r) => r.queue === 'maintenance')
      .map((r) => r.name)
      .sort();
    const schedulers = await handle!.queues.maintenance.getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual(expected);
  });
});

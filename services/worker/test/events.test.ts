import { now, parseEventPayload } from '@kora/core';
import { closeDb, emit, markEnqueued, pendingEvents, setEnqueue, sql } from '@kora/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TENANT = 'ten_worker_test';

beforeAll(async () => {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Worker test')
              ON CONFLICT (id) DO NOTHING`;
});

afterEach(async () => {
  setEnqueue(null);
  await sql()`DELETE FROM events WHERE tenant_id = ${TENANT}`;
});

afterAll(async () => {
  await sql()`DELETE FROM events WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeDb();
});

const runFinished = () => ({
  tenantId: TENANT,
  traceId: 'tr_test',
  runId: 'run_test',
  conversationId: 'conv_test',
  outcome: 'resolved_automatically',
  finalState: 'RESOLVED',
  occurredAt: now(),
});

describe('emit', () => {
  it('writes the event row before enqueueing', async () => {
    const order: string[] = [];
    setEnqueue(async () => {
      const rows = await sql()`SELECT id FROM events WHERE tenant_id = ${TENANT}`;
      order.push(rows.length > 0 ? 'row exists' : 'no row');
    });

    await emit('run.finished', runFinished());
    expect(order).toEqual(['row exists']);
  });

  it('still writes the row when the queue is unreachable', async () => {
    setEnqueue(async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await emit('run.finished', runFinished());
    expect(result.enqueued).toBe(false);

    const rows = await sql()<{ enqueued: boolean }[]>`
      SELECT enqueued FROM events WHERE id = ${result.eventId}`;
    expect(rows[0]?.enqueued).toBe(false);
  });

  it('leaves a failed enqueue for the catch-up job to find', async () => {
    setEnqueue(async () => {
      throw new Error('redis down');
    });
    await emit('run.finished', runFinished());

    const pending = await pendingEvents(TENANT);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe('run.finished');

    await markEnqueued([pending[0]!.id]);
    expect(await pendingEvents(TENANT)).toHaveLength(0);
  });

  it('marks the row enqueued once the job is on the queue', async () => {
    setEnqueue(async () => {});
    const result = await emit('run.finished', runFinished());
    expect(result.enqueued).toBe(true);

    const rows = await sql()<{ enqueued: boolean }[]>`
      SELECT enqueued FROM events WHERE id = ${result.eventId}`;
    expect(rows[0]?.enqueued).toBe(true);
  });

  it('rejects an invalid payload before writing anything', async () => {
    await expect(
      emit('run.finished', { tenantId: TENANT, traceId: 'tr' } as never),
    ).rejects.toThrow();
    expect(await sql()`SELECT id FROM events WHERE tenant_id = ${TENANT}`).toHaveLength(0);
  });

  it('rejects a confidence outside 0..1', async () => {
    await expect(
      emit('intent.detected', {
        tenantId: TENANT,
        traceId: 'tr',
        runId: 'run',
        conversationId: 'conv',
        intent: 'DAMAGED_ORDER',
        confidence: 1.5,
        occurredAt: now(),
      }),
    ).rejects.toThrow();
  });

  it('records the run and conversation as columns, not only in the payload', async () => {
    setEnqueue(async () => {});
    const result = await emit('run.finished', runFinished());
    const rows = await sql()<{ run_id: string; conversation_id: string }[]>`
      SELECT run_id, conversation_id FROM events WHERE id = ${result.eventId}`;
    expect(rows[0]).toMatchObject({ run_id: 'run_test', conversation_id: 'conv_test' });
  });
});

describe('event schemas', () => {
  it('parses every event type it declares', () => {
    expect(() =>
      parseEventPayload('policy.checked', {
        tenantId: TENANT,
        traceId: 'tr',
        runId: 'run',
        conversationId: 'conv',
        action: 'create_replacement',
        decision: 'allow',
        ruleId: 'standard_replacement',
        occurredAt: now(),
      }),
    ).not.toThrow();
  });

  it('rejects a decision that is not one of the three', () => {
    expect(() =>
      parseEventPayload('policy.checked', {
        tenantId: TENANT,
        traceId: 'tr',
        runId: 'run',
        conversationId: 'conv',
        action: 'create_replacement',
        decision: 'maybe',
        ruleId: 'x',
        occurredAt: now(),
      }),
    ).toThrow();
  });
});

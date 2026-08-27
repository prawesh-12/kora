import {
  type EventPayload,
  type EventType,
  logger,
  newId,
  now,
  parseEventPayload,
} from '@kora/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './client.js';
import { events } from './schema/events.js';

export interface EmitResult {
  eventId: string;
  enqueued: boolean;
}

/**
 * Enqueues a job for an event that has already been written. Injected because
 * `@kora/db` must not depend on the queue library or the worker service.
 */
export type Enqueue = (type: EventType, eventId: string, payload: EventPayload) => Promise<void>;

let enqueue: Enqueue | null = null;

export function setEnqueue(fn: Enqueue | null): void {
  enqueue = fn;
}

/**
 * Writes the event row **first**, then enqueues the job.
 *
 * That order is the whole design. A lost job can be replayed from the events
 * table; a lost row cannot be replayed from anywhere. If Redis is down, the row
 * is still written with `enqueued: false` and `replayPendingEvents` picks it up
 * later. The work is delayed, never lost.
 */
export async function emit<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
): Promise<EmitResult> {
  // Rejected before the row is written: a malformed event in the log is worse
  // than a missing one, because the log is what a lost job is replayed from.
  const parsed = parseEventPayload(type, payload);

  const eventId = newId('ev');
  const record = parsed as EventPayload & {
    runId?: string;
    conversationId?: string;
  };

  await db()
    .insert(events)
    .values({
      id: eventId,
      tenantId: record.tenantId,
      type,
      traceId: record.traceId,
      runId: record.runId ?? null,
      conversationId: record.conversationId ?? null,
      payload: parsed as unknown as Record<string, unknown>,
      enqueued: false,
      occurredAt: record.occurredAt,
    });

  if (!enqueue) return { eventId, enqueued: false };

  try {
    await enqueue(type, eventId, parsed);
    await db().update(events).set({ enqueued: true }).where(eq(events.id, eventId));
    return { eventId, enqueued: true };
  } catch (e) {
    logger().error({ err: e, type, eventId }, 'event written but could not be enqueued');
    return { eventId, enqueued: false };
  }
}

/** Events whose job never made it onto a queue. The catch-up path. */
export async function pendingEvents(tenantId: string, limit = 200) {
  return db()
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.enqueued, false)))
    .orderBy(asc(events.occurredAt))
    .limit(limit);
}

export async function markEnqueued(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await db().update(events).set({ enqueued: true }).where(inArray(events.id, eventIds));
}

export async function eventsForRun(tenantId: string, runId: string) {
  return db()
    .select()
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.runId, runId)))
    .orderBy(asc(events.occurredAt));
}

export function eventOccurredAt(): Date {
  return now();
}

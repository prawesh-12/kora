import type { EventPayload, EventType } from '@kora/core';
import { setEnqueue } from '@kora/db';
import type { Queue } from 'bullmq';
import { type EventJob, QUEUE_FOR_EVENT, type QueueName } from './queues.js';

/**
 * `@kora/db` must not depend on the queue library, so whoever owns the connection
 * hands it in here: the worker process, or the web process for its own events.
 */
export function wireEnqueue(queues: Record<QueueName, Queue<EventJob>>): void {
  setEnqueue(async (type: EventType, eventId: string, payload: EventPayload) => {
    const queueName = QUEUE_FOR_EVENT[type];
    if (!queueName) return;
    await queues[queueName].add(type, {
      eventId,
      type,
      payload: payload as unknown as Record<string, unknown>,
    });
  });
}

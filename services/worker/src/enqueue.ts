import type { EventPayload, EventType } from '@kora/core';
import { setEnqueue } from '@kora/db';
import type { Queue } from 'bullmq';
import { type EventJob, QUEUE_FOR_EVENT, type QueueName } from './queues.js';

/**
 * Wires `emit` in `@kora/db` to the queues. The database package must not depend
 * on the queue library, so the connection is handed in from whoever owns it: the
 * worker process, or the web process for events it emits itself.
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

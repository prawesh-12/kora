import { logger, serverEnv } from '@kora/core';
import { markEnqueued, pendingEvents } from '@kora/db';
import type { Queue } from 'bullmq';
import { type EventJob, QUEUE_FOR_EVENT, type QueueName } from '../queues.js';

/**
 * Catch-up for events whose enqueue failed, usually because Redis was down. The row
 * was written first either way, so the work is delayed rather than lost.
 */
export async function replayPendingEventsJob(
  queues: Record<QueueName, Queue<EventJob>>,
): Promise<void> {
  const rows = await pendingEvents(serverEnv().KORA_TENANT_ID);
  if (rows.length === 0) return;

  const replayed: string[] = [];
  for (const row of rows) {
    const queueName = QUEUE_FOR_EVENT[row.type as keyof typeof QUEUE_FOR_EVENT];
    if (!queueName) {
      // Recorded but not worked. Marking it stops the catch-up job re-reading it forever.
      replayed.push(row.id);
      continue;
    }
    await queues[queueName].add(row.type, {
      eventId: row.id,
      type: row.type as EventJob['type'],
      payload: row.payload,
    });
    replayed.push(row.id);
  }

  await markEnqueued(replayed);
  logger().info({ replayed: replayed.length }, 'pending events replayed');
}

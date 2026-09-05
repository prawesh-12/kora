import { logger, serverEnv } from '@kora/core';
import { setEnqueue } from '@kora/db';

let wired: boolean | null = null;

/**
 * When Redis is unreachable the wiring is skipped and `emit` records events
 * without enqueueing, which callers read to fall back to inline evaluation. That
 * fallback is what keeps a single-process deployment working with no worker.
 */
export async function wireQueues(): Promise<boolean> {
  if (wired !== null) return wired;

  try {
    const { Queue } = await import('bullmq');
    const IORedis = (await import('ioredis')).default;
    const connection = new IORedis(serverEnv().REDIS_URL, { maxRetriesPerRequest: null });
    const queues = {
      evaluation: new Queue('evaluation', { connection }),
      ingestion: new Queue('ingestion', { connection }),
      maintenance: new Queue('maintenance', { connection }),
    } as const;

    const queueFor: Record<string, keyof typeof queues> = {
      'run.finished': 'evaluation',
      'document.indexed': 'ingestion',
      'approval.expired': 'maintenance',
    };

    setEnqueue(async (type, eventId, payload) => {
      const name = queueFor[type];
      if (!name) return;
      await queues[name].add(type, { eventId, type, payload });
    });

    wired = true;
  } catch (e) {
    logger().warn({ err: e }, 'could not reach the queue, evaluation will run inline');
    wired = false;
  }

  return wired;
}

export function workerIsWired(): boolean {
  return wired === true;
}

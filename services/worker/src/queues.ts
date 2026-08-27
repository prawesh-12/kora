import { type EventType, serverEnv } from '@kora/core';
import { type JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';

export type QueueName = 'evaluation' | 'ingestion' | 'maintenance';

export const CONCURRENCY: Record<QueueName, number> = {
  evaluation: 5,
  ingestion: 2,
  maintenance: 1,
};

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 86_400, count: 5000 },
  // Failed jobs are kept. A dead-lettered job nobody can read is a job silently dropped.
  removeOnFail: false,
};

/**
 * BullMQ needs `maxRetriesPerRequest: null` on the connection it blocks on, and
 * shares one connection across every queue and worker in the process.
 */
export function createConnection(): IORedis {
  return new IORedis(serverEnv().REDIS_URL, { maxRetriesPerRequest: null });
}

/** Which queue handles which event. Anything unlisted is recorded but not worked. */
export const QUEUE_FOR_EVENT: Partial<Record<EventType, QueueName>> = {
  'run.finished': 'evaluation',
  'document.indexed': 'ingestion',
  'approval.expired': 'maintenance',
};

export interface EventJob {
  eventId: string;
  type: EventType;
  payload: Record<string, unknown>;
}

export function createQueues(connection: IORedis): Record<QueueName, Queue<EventJob>> {
  const make = (name: QueueName) =>
    new Queue<EventJob>(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  return {
    evaluation: make('evaluation'),
    ingestion: make('ingestion'),
    maintenance: make('maintenance'),
  };
}

/**
 * Repeatable jobs, replacing the CLI commands from M0 and M1. One code path, not
 * two: the CLI entry points stay only as a way to run the same job by hand.
 */
export const REPEATABLE: Array<{ name: string; queue: QueueName; pattern: string }> = [
  { name: 'cleanup-idempotency', queue: 'maintenance', pattern: '0 * * * *' },
  { name: 'expire-approvals', queue: 'maintenance', pattern: '* * * * *' },
  { name: 'replay-pending-events', queue: 'maintenance', pattern: '*/5 * * * *' },
  { name: 'purge-retention', queue: 'maintenance', pattern: '0 3 * * *' },
  { name: 'shadow-compare', queue: 'maintenance', pattern: '0 2 * * *' },
];

import { pathToFileURL } from 'node:url';
import { logger, serverEnv } from '@kora/core';
import { closeDb } from '@kora/db';
import { type Job, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { wireEnqueue } from './enqueue.js';
import { evaluateRunJob } from './jobs/evaluate-run.js';
import { cleanupIdempotencyJob } from './jobs/cleanup-idempotency.js';
import { expireApprovalsJob } from './jobs/expire-approvals.js';
import { ingestDocumentJob } from './jobs/ingest-document.js';
import { purgeRetentionJob } from './jobs/purge-retention.js';
import { shadowCompareJob } from './jobs/shadow-compare.js';
import { replayPendingEventsJob } from './jobs/replay-pending-events.js';
import {
  CONCURRENCY,
  DEFAULT_JOB_OPTIONS,
  type EventJob,
  type QueueName,
  REPEATABLE,
  createConnection,
  createQueues,
} from './queues.js';

const SHUTDOWN_GRACE_MS = 30_000;

export async function startWorker() {
  const connection: IORedis = createConnection();
  const queues = createQueues(connection);
  wireEnqueue(queues);
  const log = logger();

  const handle = async (queue: QueueName, job: Job<EventJob>) => {
    if (queue === 'maintenance') {
      switch (job.name) {
        case 'cleanup-idempotency':
          return cleanupIdempotencyJob();
        case 'expire-approvals':
          return expireApprovalsJob();
        case 'replay-pending-events':
          return replayPendingEventsJob(queues);
        case 'purge-retention':
          return purgeRetentionJob();
        case 'shadow-compare':
          return shadowCompareJob();
        default:
          return;
      }
    }
    if (queue === 'evaluation') return evaluateRunJob(job.data);
    if (queue === 'ingestion') return ingestDocumentJob(job.data);
  };

  const workers = (['evaluation', 'ingestion', 'maintenance'] as QueueName[]).map((name) => {
    const worker = new Worker<EventJob>(name, (job) => handle(name, job), {
      connection,
      concurrency: CONCURRENCY[name],
    });
    worker.on('failed', (job, err) => {
      log.error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err }, 'job failed');
    });
    return worker;
  });

  // Repeatable work is a job scheduler in current BullMQ, not a `repeat` option.
  for (const { name, queue, pattern } of REPEATABLE) {
    await queues[queue].upsertJobScheduler(
      name,
      { pattern },
      {
        name,
        data: { eventId: name, type: 'run.finished', payload: {} } as EventJob,
        opts: DEFAULT_JOB_OPTIONS,
      },
    );
  }

  log.info({ queues: Object.keys(queues), repeatable: REPEATABLE.length }, 'worker started');

  const stop = async () => {
    log.info('worker shutting down, waiting for in-flight jobs');
    const closing = Promise.all(workers.map((w) => w.close()));
    const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
    await Promise.race([closing, timeout]);
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await connection.quit().catch(() => {});
    await closeDb().catch(() => {});
    log.info('worker stopped');
  };

  return { queues, workers, connection, stop };
}

export type WorkerHandle = Awaited<ReturnType<typeof startWorker>>;

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

if (isMain(import.meta.url)) {
  const handle = await startWorker();
  void serverEnv();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      handle.stop().then(() => process.exit(0));
    });
  }
}

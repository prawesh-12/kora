import { logger, serverEnv } from '@kora/core';
import { listVersions } from '@kora/db';
import type { BreakerState } from '@kora/tools';
import { breaker, modelBreakerKey, registry, toolBreakerKey } from '@kora/tools';
import type { Queue } from 'bullmq';
import { requireOperator } from '@/lib/api/auth';
import { handle } from '@/lib/api/errors';
import pkg from '../../../package.json';

export const dynamic = 'force-dynamic';

const QUEUE_NAMES = ['evaluation', 'ingestion', 'maintenance'] as const;
type QueueName = (typeof QUEUE_NAMES)[number];

let queues: Record<QueueName, Queue> | null = null;

async function queueHandles(): Promise<Record<QueueName, Queue>> {
  if (!queues) {
    const { Queue } = await import('bullmq');
    const IORedis = (await import('ioredis')).default;
    const connection = new IORedis(serverEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    connection.on('error', (e) => logger().debug({ err: e }, 'status queue connection error'));
    queues = {
      evaluation: new Queue('evaluation', { connection }),
      ingestion: new Queue('ingestion', { connection }),
      maintenance: new Queue('maintenance', { connection }),
    };
  }
  return queues;
}

async function queueDepth(): Promise<Record<QueueName, Record<string, number>> | null> {
  try {
    const handles = await queueHandles();
    const counts = await Promise.all(
      QUEUE_NAMES.map(async (name) => [name, await handles[name].getJobCounts()] as const),
    );
    return Object.fromEntries(counts) as Record<QueueName, Record<string, number>>;
  } catch (e) {
    logger().warn({ err: e }, 'could not read queue depth');
    return null;
  }
}

async function breakerStates(tenantId: string): Promise<Record<string, BreakerState> | null> {
  const keys = [
    modelBreakerKey(serverEnv().KORA_MODEL_PROVIDER),
    ...registry.list().map((tool) => toolBreakerKey(tenantId, tool.name)),
  ];
  try {
    const states = await Promise.all(
      [...new Set(keys)].map(async (key) => [key, await breaker().state(key)] as const),
    );
    return Object.fromEntries(states);
  } catch (e) {
    logger().warn({ err: e }, 'could not read circuit breaker state');
    return null;
  }
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    await requireOperator();
    const tenantId = serverEnv().KORA_TENANT_ID;

    const [versions, depth, breakers] = await Promise.all([
      listVersions(tenantId),
      queueDepth(),
      breakerStates(tenantId),
    ]);

    return Response.json({
      version: pkg.version,
      deploymentMode: serverEnv().KORA_DEPLOYMENT_MODE,
      activeAgentVersions: versions
        .filter((v) => v.status === 'active')
        .map((v) => ({ id: v.id, version: v.version, model: v.model, activatedAt: v.activatedAt })),
      queueDepth: depth,
      breakers,
    });
  });
}

import { serverEnv } from '@kora/core';
import Redis from 'ioredis';

const WINDOW_SECONDS = 60;
const MAX_PER_WINDOW = 30;

let client: Redis | null = null;

function redis(): Redis {
  if (!client) client = new Redis(serverEnv().REDIS_URL, { maxRetriesPerRequest: 2 });
  return client;
}

export interface RateVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * A fixed window, not a sliding one: one counter keyed by conversation, expiring
 * after the window. A burst can straddle two windows, which is acceptable here.
 */
export async function takeMessageSlot(conversationId: string): Promise<RateVerdict> {
  const key = `kora:rate:chat:${conversationId}`;
  const count = await redis().incr(key);
  if (count === 1) await redis().expire(key, WINDOW_SECONDS);
  if (count <= MAX_PER_WINDOW) return { allowed: true, retryAfterSeconds: 0 };

  const ttl = await redis().ttl(key);
  return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
}

export async function closeRateLimiter(): Promise<void> {
  if (client) await client.quit();
  client = null;
}

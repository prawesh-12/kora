import { randomUUID } from 'node:crypto';
import { serverEnv } from '@kora/core';
import { breaker, closeBreaker, modelBreakerKey } from '@kora/tools';
import Redis from 'ioredis';
import { ApiError } from '@/lib/api/errors';

export type RouteClass = 'chat' | 'ops' | 'auth';

export const LIMITS: Record<RouteClass, { limit: number; windowMs: number }> = {
  chat: { limit: 30, windowMs: 60_000 },
  ops: { limit: 300, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
};

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
 * A sliding window held as a sorted set of timestamps: a fixed counter would let a
 * caller spend the whole budget either side of a window boundary.
 *
 * A denied request is not added to the set, so a client that keeps hammering does
 * not push its own recovery further away.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const t = Date.now();
  const r = redis();

  await r.zremrangebyscore(key, 0, t - windowMs);
  const used = await r.zcard(key);

  if (used >= limit) {
    const [, oldestScore] = await r.zrange(key, 0, '0', 'WITHSCORES');
    const oldestAt = oldestScore ? Number(oldestScore) : t;
    return { allowed: false, retryAfterMs: Math.max(1, oldestAt + windowMs - t) };
  }

  await r.multi().zadd(key, t, `${t}:${randomUUID()}`).pexpire(key, windowMs).exec();
  return { allowed: true, retryAfterMs: 0 };
}

export function rateLimitKey(routeClass: RouteClass, subject: string): string {
  return `kora:rate:${serverEnv().KORA_TENANT_ID}:${routeClass}:${subject}`;
}

export async function takeRouteSlot(routeClass: RouteClass, subject: string): Promise<RateVerdict> {
  const { limit, windowMs } = LIMITS[routeClass];
  const verdict = await checkRateLimit(rateLimitKey(routeClass, subject), limit, windowMs);
  return {
    allowed: verdict.allowed,
    retryAfterSeconds: Math.ceil(verdict.retryAfterMs / 1000),
  };
}

/**
 * An open breaker throws rather than returning a verdict: when both it and the rate
 * limit apply, "the dependency is down" is the more actionable answer.
 */
export async function takeMessageSlot(conversationId: string): Promise<RateVerdict> {
  const gate = await breaker().gate(modelBreakerKey(serverEnv().KORA_MODEL_PROVIDER), 'read');
  if (!gate.pass) {
    throw new ApiError(
      503,
      'UPSTREAM_UNAVAILABLE',
      'the assistant is unavailable right now, please try again shortly',
      { 'Retry-After': '30' },
    );
  }
  return takeRouteSlot('chat', conversationId);
}

export async function closeRateLimiter(): Promise<void> {
  if (client) await client.quit();
  client = null;
  await closeBreaker();
}

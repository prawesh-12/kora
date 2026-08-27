import { randomUUID } from 'node:crypto';
import { KoraError, logger, now, serverEnv } from '@kora/core';
import Redis from 'ioredis';

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface Breaker {
  state(key: string): Promise<BreakerState>;
  recordSuccess(key: string): Promise<void>;
  recordFailure(key: string): Promise<void>;
}

export type BreakerVerdict =
  | { pass: true; state: 'closed' | 'half_open' }
  | { pass: false; reason: 'open' | 'store_unavailable' };

export interface GatedBreaker extends Breaker {
  gate(key: string, kind: 'read' | 'write'): Promise<BreakerVerdict>;
  close(): Promise<void>;
}

export class BreakerUnavailableError extends KoraError {}

export interface BreakerOptions {
  redisUrl?: string;
  failureThreshold?: number;
  windowMs?: number;
  /** How long the breaker stays open before it admits a half-open probe. */
  openMs?: number;
}

const STUCK_OPEN_MS = 600_000;
const OPEN_TTL_MS = 2 * STUCK_OPEN_MS;
const ALERT_INTERVAL_MS = 60_000;

export function toolBreakerKey(tenantId: string, toolName: string): string {
  return `tool:${tenantId}:${toolName}`;
}

export function modelBreakerKey(provider: string): string {
  return `model:${provider}`;
}

export function createBreaker(opts: BreakerOptions = {}): GatedBreaker {
  const failureThreshold = opts.failureThreshold ?? 5;
  const windowMs = opts.windowMs ?? 60_000;
  const openMs = opts.openMs ?? 30_000;

  const openKey = (key: string) => `kora:cb:${key}:open`;
  const sinceKey = (key: string) => `kora:cb:${key}:since`;
  const failsKey = (key: string) => `kora:cb:${key}:fails`;
  const alertKey = (key: string) => `kora:cb:${key}:alerted`;

  let client: Redis | null = null;

  function redis(): Redis {
    if (!client) {
      client = new Redis(opts.redisUrl ?? serverEnv().REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 1000,
        commandTimeout: 1000,
        retryStrategy: (times) => Math.min(times * 200, 2000),
      });
      // Without a listener a dropped connection raises an unhandled 'error' event and
      // takes the process down, which is the opposite of what a breaker is for.
      client.on('error', (e) => logger().debug({ err: e }, 'circuit breaker redis error'));
    }
    return client;
  }

  async function surfaceStuckOpen(key: string, openForMs: number): Promise<void> {
    const first = await redis()
      .set(alertKey(key), '1', 'PX', ALERT_INTERVAL_MS, 'NX')
      .catch(() => null);
    if (!first) return;
    logger().error(
      { code: 'BREAKER_STUCK_OPEN', breakerKey: key, openForMs },
      'a circuit breaker has been open for more than ten minutes and the dependency is not recovering',
    );
  }

  async function state(key: string): Promise<BreakerState> {
    let openedAt: string | null | undefined;
    let since: string | null | undefined;
    try {
      [openedAt, since] = await redis().mget(openKey(key), sinceKey(key));
    } catch (e) {
      throw new BreakerUnavailableError('the circuit breaker store is unreachable', {
        code: 'BREAKER_UNAVAILABLE',
        retryable: true,
        cause: e,
      });
    }

    if (!openedAt) return 'closed';
    const t = now().getTime();
    if (since && t - Number(since) >= STUCK_OPEN_MS) {
      await surfaceStuckOpen(key, t - Number(since));
    }
    return t - Number(openedAt) >= openMs ? 'half_open' : 'open';
  }

  async function open(key: string, at: number): Promise<void> {
    const r = redis();
    await r.set(openKey(key), String(at), 'PX', OPEN_TTL_MS);
    await r.set(sinceKey(key), String(at), 'PX', OPEN_TTL_MS, 'NX');
    await r.del(failsKey(key));
  }

  async function recordFailure(key: string): Promise<void> {
    const t = now().getTime();
    try {
      const r = redis();
      // A probe that fails re-opens for a full interval. Counting it toward the window
      // instead would let a dead dependency drift back to closed on a stale count.
      if (await r.get(openKey(key))) {
        await r.set(openKey(key), String(t), 'PX', OPEN_TTL_MS);
        await r.del(failsKey(key));
        return;
      }

      await r
        .multi()
        .zremrangebyscore(failsKey(key), 0, t - windowMs)
        .zadd(failsKey(key), t, `${t}:${randomUUID()}`)
        .pexpire(failsKey(key), windowMs)
        .exec();

      if ((await r.zcard(failsKey(key))) >= failureThreshold) await open(key, t);
    } catch (e) {
      logger().warn({ err: e, breakerKey: key }, 'could not record a circuit breaker failure');
    }
  }

  async function recordSuccess(key: string): Promise<void> {
    try {
      await redis().del(openKey(key), sinceKey(key), failsKey(key), alertKey(key));
    } catch (e) {
      logger().warn({ err: e, breakerKey: key }, 'could not record a circuit breaker success');
    }
  }

  /**
   * Redis being unreadable is not the same as the dependency being healthy, and the
   * breaker cannot tell those two apart. For a write we refuse: the idempotency store
   * is Postgres, but with the breaker unreadable we cannot say whether the dependency
   * is up, and a duplicated or unrecorded business action cannot be taken back. For a
   * read the worst case of going ahead is a slow failure, which is acceptable.
   */
  async function gate(key: string, kind: 'read' | 'write'): Promise<BreakerVerdict> {
    let current: BreakerState;
    try {
      current = await state(key);
    } catch {
      return kind === 'write'
        ? { pass: false, reason: 'store_unavailable' }
        : { pass: true, state: 'closed' };
    }
    return current === 'open' ? { pass: false, reason: 'open' } : { pass: true, state: current };
  }

  async function close(): Promise<void> {
    if (!client) return;
    const c = client;
    client = null;
    await c.quit().catch(() => c.disconnect());
  }

  return { state, recordSuccess, recordFailure, gate, close };
}

let shared: GatedBreaker | null = null;

export function breaker(): GatedBreaker {
  if (!shared) shared = createBreaker();
  return shared;
}

/** Mirrors `setMockPlanners`: lets a test point the pipeline at a different store. */
export function setBreaker(next: GatedBreaker | null): void {
  shared = next;
}

export async function closeBreaker(): Promise<void> {
  if (shared) await shared.close();
  shared = null;
}

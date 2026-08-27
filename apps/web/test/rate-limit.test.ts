import { serverEnv } from '@kora/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ after: () => {} }));

let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));

const { LIMITS, checkRateLimit, closeRateLimiter, rateLimitKey, takeRouteSlot } = await import(
  '@/lib/rate-limit'
);
const { GET: authGet } = await import('@/app/api/auth/[...all]/route');
const { GET: getMetrics } = await import('@/app/api/metrics/route');

const redis = async () => {
  const IORedis = (await import('ioredis')).default;
  return new IORedis(serverEnv().REDIS_URL, { maxRetriesPerRequest: 1 });
};

async function clear(routeClass: 'chat' | 'ops' | 'auth', subject: string) {
  const r = await redis();
  await r.del(rateLimitKey(routeClass, subject));
  await r.quit();
}

afterAll(closeRateLimiter);

beforeEach(() => {
  requestHeaders = new Headers();
});

describe('the sliding window', () => {
  it('counts the last window wherever the boundary falls', async () => {
    const key = `kora:rate:test:${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true);
    }
    const denied = await checkRateLimit(key, 3, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);

    // A denied request is not added to the set, so hammering does not push the
    // caller's own recovery further away.
    const again = await checkRateLimit(key, 3, 60_000);
    expect(again.retryAfterMs).toBeLessThanOrEqual(denied.retryAfterMs);
  });

  it('lets the window expire', async () => {
    const key = `kora:rate:test:short:${Date.now()}`;
    expect((await checkRateLimit(key, 1, 150)).allowed).toBe(true);
    expect((await checkRateLimit(key, 1, 150)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 220));
    expect((await checkRateLimit(key, 1, 150)).allowed).toBe(true);
  });
});

describe('the operator limit', () => {
  it('applies to every operator route, because it lives in requireOperator', async () => {
    const subject = `usr_rate_${Date.now()}`;
    await clear('ops', subject);

    for (let i = 0; i < LIMITS.ops.limit; i++) {
      expect((await takeRouteSlot('ops', subject)).allowed).toBe(true);
    }
    const denied = await takeRouteSlot('ops', subject);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);

    await clear('ops', subject);
  });

  it('still answers 401 before it answers 429', async () => {
    // An unauthenticated caller never reaches the limiter, so a wrong password
    // cannot be used to exhaust somebody else's operator budget.
    const res = await getMetrics(new Request('http://localhost/api/metrics'));
    expect(res.status).toBe(401);
  });
});

describe('the auth limit', () => {
  it('is keyed on the caller address and denies past the limit', async () => {
    const address = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    await clear('auth', address);

    for (let i = 0; i < LIMITS.auth.limit; i++) {
      expect((await takeRouteSlot('auth', address)).allowed).toBe(true);
    }
    expect((await takeRouteSlot('auth', address)).allowed).toBe(false);

    const res = await authGet(
      new Request('http://localhost/api/auth/get-session', {
        headers: { 'x-forwarded-for': address },
      }),
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);

    await clear('auth', address);
  });

  it('lets a different address through while one is throttled', async () => {
    const other = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    await clear('auth', other);

    const res = await authGet(
      new Request('http://localhost/api/auth/get-session', {
        headers: { 'x-forwarded-for': other },
      }),
    );
    expect(res.status).not.toBe(429);

    await clear('auth', other);
  });
});

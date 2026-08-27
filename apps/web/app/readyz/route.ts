import { now, serverEnv } from '@kora/core';
import { sql } from '@kora/db';

export const dynamic = 'force-dynamic';

const TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 3_000;

interface Check {
  ok: boolean;
  detail: string;
}

interface Readiness {
  ready: boolean;
  checkedAt: string;
  checks: { postgres: Check; redis: Check; model: Check };
}

let cached: Readiness | null = null;
let cachedAtMs = 0;
let inFlight: Promise<Readiness> | null = null;

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms).unref?.();
  });
}

async function probe(fn: () => Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await Promise.race([fn(), timeout(PROBE_TIMEOUT_MS)]) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkPostgres(): Promise<string> {
  const rows = await sql()`select 1 as ok`;
  if (rows[0]?.ok !== 1) throw new Error('postgres answered but not with 1');
  return 'select 1 ok';
}

async function checkRedis(): Promise<string> {
  const IORedis = (await import('ioredis')).default;
  const client = new IORedis(serverEnv().REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: PROBE_TIMEOUT_MS,
    commandTimeout: PROBE_TIMEOUT_MS,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    return `ping ${await client.ping()}`;
  } finally {
    client.disconnect();
  }
}

/**
 * `mock` is the default provider and answers in-process, so probing it over the
 * network would be measuring nothing. A hosted provider gets one real call, which
 * the 10 second cache keeps down to six an hour rather than one per probe.
 */
async function checkModelProvider(): Promise<string> {
  const env = serverEnv();
  switch (env.KORA_MODEL_PROVIDER) {
    case 'mock':
      return 'mock provider, answered in process';
    case 'openai': {
      if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`openai answered ${res.status}`);
      return 'openai answered 200';
    }
    case 'anthropic': {
      if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`anthropic answered ${res.status}`);
      return 'anthropic answered 200';
    }
  }
}

async function measure(): Promise<Readiness> {
  const [postgres, redis, model] = await Promise.all([
    probe(checkPostgres),
    probe(checkRedis),
    probe(checkModelProvider),
  ]);
  return {
    ready: postgres.ok && redis.ok && model.ok,
    checkedAt: now().toISOString(),
    checks: { postgres, redis, model },
  };
}

/**
 * One measurement per ten seconds, shared by every concurrent probe. Without the
 * cache a rate limited provider makes readiness flap, and every load balancer
 * probe turns into an outbound call of its own.
 */
async function readiness(): Promise<Readiness> {
  const nowMs = now().getTime();
  if (cached && nowMs - cachedAtMs < TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = measure()
    .then((result) => {
      cached = result;
      cachedAtMs = now().getTime();
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function GET(): Promise<Response> {
  const result = await readiness();
  return Response.json(result, {
    status: result.ready ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}

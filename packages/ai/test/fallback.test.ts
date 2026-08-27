import { ConfigError, logger, serverEnv } from '@kora/core';
import { closeDb, sql } from '@kora/db';
import { breaker, closeBreaker, modelBreakerKey } from '@kora/tools';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fallbackModelFor, setFallbackModel } from '../src/fallback.js';
import { callModel } from '../src/gateway.js';

const TENANT = 'ten_fallback_test';
const FALLBACK_MODEL = 'mock-agent-fallback';

function unavailable(): Error {
  return Object.assign(new Error('provider is down'), { statusCode: 503 });
}

function modelIdOf(model: unknown): string {
  return (model as { modelId?: string }).modelId ?? '';
}

async function providers(): Promise<string[]> {
  const rows = await sql()<{ provider: string; model: string }[]>`
    SELECT provider, model FROM llm_calls WHERE tenant_id = ${TENANT} ORDER BY id`;
  return rows.map((r) => `${r.provider}/${r.model}`);
}

beforeAll(async () => {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Fallback test')
              ON CONFLICT (id) DO NOTHING`;
});

beforeEach(async () => {
  setFallbackModel(null);
  await sql()`DELETE FROM llm_calls WHERE tenant_id = ${TENANT}`;
  await breaker().recordSuccess(modelBreakerKey(serverEnv().KORA_MODEL_PROVIDER));
  await breaker().recordSuccess(modelBreakerKey(`fallback:${serverEnv().KORA_MODEL_PROVIDER}`));
});

afterEach(() => {
  setFallbackModel(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await breaker().recordSuccess(modelBreakerKey(serverEnv().KORA_MODEL_PROVIDER));
  await breaker().recordSuccess(modelBreakerKey(`fallback:${serverEnv().KORA_MODEL_PROVIDER}`));
  await sql()`DELETE FROM llm_calls WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeBreaker();
  await closeDb();
});

describe('agent model fallback', () => {
  it('answers from the fallback after the primary exhausts its attempts, and says so', async () => {
    setFallbackModel(FALLBACK_MODEL);
    const warn = vi.spyOn(logger(), 'warn');
    const tried: string[] = [];

    const result = await callModel({
      purpose: 'agent',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: async (model) => {
        const id = modelIdOf(model);
        tried.push(id);
        if (id !== FALLBACK_MODEL) throw unavailable();
        return { text: 'answered by the fallback' };
      },
      usageOf: () => ({ inputTokens: { total: 10 }, outputTokens: { total: 4 } }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toBe('answered by the fallback');
    expect(tried).toEqual(['mock-agent', 'mock-agent', FALLBACK_MODEL]);

    expect(await providers()).toEqual([
      'mock/mock-agent',
      'mock/mock-agent',
      `fallback:mock/${FALLBACK_MODEL}`,
    ]);

    const logged = warn.mock.calls.find(
      (call) => (call[0] as { code?: string })?.code === 'model.fallback_used',
    );
    expect(logged, 'the fallback must never be silent').toBeDefined();
    expect(logged?.[0]).toMatchObject({ primary: 'mock-agent', fallback: FALLBACK_MODEL });
    expect(String(logged?.[1])).toContain('model.fallback_used');
  });

  it('does not fall back on an error the primary will never recover from', async () => {
    setFallbackModel(FALLBACK_MODEL);
    const tried: string[] = [];

    const result = await callModel({
      purpose: 'agent',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: async (model) => {
        tried.push(modelIdOf(model));
        throw Object.assign(new Error('bad request'), { statusCode: 400 });
      },
    });

    expect(result.ok).toBe(false);
    expect(tried).toEqual(['mock-agent']);
    expect(await providers()).toEqual(['mock/mock-agent']);
  });

  it('behaves exactly as before when no fallback is configured', async () => {
    const tried: string[] = [];

    const result = await callModel({
      purpose: 'agent',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: async (model) => {
        tried.push(modelIdOf(model));
        throw unavailable();
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MODEL_UNAVAILABLE');
    expect(tried).toEqual(['mock-agent', 'mock-agent']);
  });

  it('reports the fallback failure when the fallback is down too', async () => {
    setFallbackModel(FALLBACK_MODEL);

    const result = await callModel({
      purpose: 'agent',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: async () => {
        throw unavailable();
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MODEL_UNAVAILABLE');
    expect(await providers()).toEqual([
      'mock/mock-agent',
      'mock/mock-agent',
      `fallback:mock/${FALLBACK_MODEL}`,
    ]);
  });
});

describe('the judge never falls back', () => {
  it('resolves a fallback for the agent role and for nothing else', () => {
    setFallbackModel(FALLBACK_MODEL);
    expect(fallbackModelFor('agent')?.modelId).toBe(FALLBACK_MODEL);
    expect(fallbackModelFor('classifier')).toBeNull();
  });

  it('refuses a fallback that is the judge model', () => {
    setFallbackModel(serverEnv().KORA_MODEL_JUDGE);
    expect(() => fallbackModelFor('agent')).toThrow(ConfigError);

    setFallbackModel('mockjudge-v9');
    expect(() => fallbackModelFor('agent')).toThrow(/judge/);
  });

  it('leaves a classifier call on its own provider even with a fallback configured', async () => {
    setFallbackModel(FALLBACK_MODEL);
    const tried: string[] = [];

    const result = await callModel({
      purpose: 'classifier',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: async (model) => {
        tried.push(modelIdOf(model));
        throw unavailable();
      },
    });

    expect(result.ok).toBe(false);
    expect(tried).toEqual(['mock-classifier', 'mock-classifier']);
    expect((await providers()).every((p) => !p.startsWith('fallback:'))).toBe(true);
  });
});

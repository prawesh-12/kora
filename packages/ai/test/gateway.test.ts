import { closeDb, sql, withTenant } from '@kora/db';
import { generateText } from 'ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { callModel, normaliseUsage } from '../src/gateway.js';
import { createMockLanguageModel } from '../src/mock/language-model.js';
import { costUsdMicros } from '../src/pricing.js';
import { setMockPlanners } from '../src/models.js';

const TENANT = 'ten_gateway_test';

beforeAll(async () => {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Gateway test')
              ON CONFLICT (id) DO NOTHING`;
});

beforeEach(async () => {
  setMockPlanners([]);
  await sql()`DELETE FROM llm_calls WHERE tenant_id = ${TENANT}`;
});

afterAll(async () => {
  await sql()`DELETE FROM llm_calls WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeDb();
});

async function allCalls() {
  return sql()<
    { status: string; model: string; input_tokens: number; cost_usd_micros: string | null }[]
  >`SELECT status, model, input_tokens, cost_usd_micros FROM llm_calls WHERE tenant_id = ${TENANT}`;
}

describe('callModel', () => {
  it('writes one row with tokens and a computed cost on success', async () => {
    const result = await callModel({
      purpose: 'classifier',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: (model, signal) =>
        generateText({
          model,
          prompt: 'my coffee machine from order 9832 arrived broken',
          abortSignal: signal,
        }),
    });

    expect(result.ok).toBe(true);
    const rows = await allCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ok');
    expect(rows[0]?.input_tokens).toBeGreaterThan(0);
    expect(Number(rows[0]?.cost_usd_micros)).toBeGreaterThan(0);
  });

  it('retries a timeout once and writes a row per attempt', async () => {
    const slow = createMockLanguageModel({
      modelId: 'mock-classifier',
      planners: [],
      latencyMs: 400,
    });
    const result = await callModel({
      purpose: 'classifier',
      tenantId: TENANT,
      timeoutMs: 50,
      fn: (_model, signal) =>
        generateText({ model: slow as never, prompt: 'hello', abortSignal: signal }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MODEL_TIMEOUT');
      expect(result.error.retryable).toBe(true);
    }
    const rows = await allCalls();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'failed')).toBe(true);
  });

  it('does not retry a 400 and writes exactly one row', async () => {
    let attempts = 0;
    const result = await callModel({
      purpose: 'classifier',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: async () => {
        attempts++;
        throw Object.assign(new Error('bad request'), { statusCode: 400 });
      },
    });

    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MODEL_REQUEST_INVALID');
    expect(await allCalls()).toHaveLength(1);
  });

  it('retries a 429 once', async () => {
    let attempts = 0;
    const result = await callModel({
      purpose: 'classifier',
      tenantId: TENANT,
      timeoutMs: 5000,
      fn: async () => {
        attempts++;
        throw Object.assign(new Error('slow down'), { statusCode: 429 });
      },
    });

    expect(attempts).toBe(2);
    if (!result.ok) expect(result.error.code).toBe('MODEL_RATE_LIMITED');
    expect(await allCalls()).toHaveLength(2);
  });

  it('records a null cost for an unpriced model without throwing', () => {
    expect(costUsdMicros('model-nobody-priced', { inputTokens: 100, outputTokens: 10 })).toBeNull();
    expect(costUsdMicros('mock-agent', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      3_000_000,
    );
  });
});

describe('normaliseUsage', () => {
  it('flattens the nested SDK shape', () => {
    expect(
      normaliseUsage({
        inputTokens: { total: 120, cacheRead: 10, cacheWrite: 5 },
        outputTokens: { total: 30 },
      }),
    ).toEqual({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 5 });
  });

  it('tolerates a missing or flat usage object', () => {
    expect(normaliseUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(normaliseUsage({ inputTokens: 7, outputTokens: 3 })).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
    });
  });
});

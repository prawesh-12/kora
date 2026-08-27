import { createHash } from 'node:crypto';
import { ConfigError, logger, now, serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import { getEmbeddingModelId, providerName } from './models.js';
import { costUsdMicros } from './pricing.js';

const BATCH_SIZE = 96;

/**
 * A deterministic stand-in for a real embedding model.
 *
 * Hashed token counts projected onto a fixed number of dimensions, then L2
 * normalised. It is a bag-of-words model, so cosine distance tracks word overlap:
 * enough for retrieval to rank the right chunk first and for the pgvector query
 * plan to be exercised, and it never costs anything or needs a key.
 */
export function mockEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    for (let k = 0; k < 4; k++) {
      const index = digest.readUInt32BE(k * 4) % dimensions;
      const sign = (digest[16 + k] ?? 0) % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
  }

  const norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((v) => v / norm);
}

async function embedChunk(texts: string[]): Promise<Array<number[] | null>> {
  const env = serverEnv();
  const dimensions = env.KORA_EMBEDDING_DIMENSIONS;

  if (env.KORA_MODEL_PROVIDER === 'mock') {
    return texts.map((t) => mockEmbedding(t, dimensions));
  }

  if (!env.OPENAI_API_KEY) {
    throw new ConfigError('embeddings need OPENAI_API_KEY unless KORA_MODEL_PROVIDER=mock', {
      code: 'MISSING_PROVIDER_KEY',
    });
  }

  const model = createOpenAI({ apiKey: env.OPENAI_API_KEY }).textEmbeddingModel(
    getEmbeddingModelId(),
  );
  const { embeddings } = await embedMany({ model, values: texts });

  for (const e of embeddings) {
    if (e.length !== dimensions) {
      throw new ConfigError(
        `embedding model ${getEmbeddingModelId()} returned ${e.length} dimensions, the schema declares ${dimensions}`,
        { code: 'EMBEDDING_DIMENSION_MISMATCH' },
      );
    }
  }
  return embeddings;
}

export async function embedBatch(
  texts: string[],
  ctx: { tenantId: string; runId?: string },
): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  const modelId = getEmbeddingModelId();

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const startedAt = Date.now();
    let embeddings: Array<number[] | null>;
    let status = 'ok';

    try {
      embeddings = await embedChunk(batch);
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      status = 'failed';
      logger().warn({ err: e, size: batch.length }, 'embedding batch failed, halving');
      embeddings = await halveAndRetry(batch);
    }

    const inputTokens = batch.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    await withTenant(ctx.tenantId).llmCalls.create({
      runId: ctx.runId ?? null,
      purpose: 'embedding',
      model: modelId,
      provider: providerName(),
      inputTokens,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      costUsdMicros: costUsdMicros(modelId, { inputTokens, outputTokens: 0 }),
      status,
      createdAt: now(),
    });

    out.push(...embeddings);
  }

  return out;
}

async function halveAndRetry(batch: string[]): Promise<Array<number[] | null>> {
  if (batch.length === 1) return [null];
  const mid = Math.floor(batch.length / 2);
  const [left, right] = await Promise.all([
    embedChunk(batch.slice(0, mid)).catch(() => halveAndRetry(batch.slice(0, mid))),
    embedChunk(batch.slice(mid)).catch(() => halveAndRetry(batch.slice(mid))),
  ]);
  return [...left, ...right];
}

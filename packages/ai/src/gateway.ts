import { ModelError, type Result, err, logger, now, ok, serverEnv } from '@kora/core';
import { withTenant } from '@kora/db';
import type { LanguageModel } from 'ai';
import { getModel, providerName } from './models.js';
import { costUsdMicros } from './pricing.js';

export interface RunContext {
  tenantId: string;
  runId: string;
  traceId: string;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const ZERO_USAGE: CallUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * The AI SDK reports usage as nested totals with optional fields. Flatten it once,
 * here, so the `llm_calls` row shape does not leak into every caller.
 */
export function normaliseUsage(usage: unknown): CallUsage {
  if (!usage || typeof usage !== 'object') return ZERO_USAGE;
  const u = usage as {
    inputTokens?: { total?: number; cacheRead?: number; cacheWrite?: number } | number;
    outputTokens?: { total?: number } | number;
  };
  const input =
    typeof u.inputTokens === 'number' ? { total: u.inputTokens } : (u.inputTokens ?? {});
  const output =
    typeof u.outputTokens === 'number' ? { total: u.outputTokens } : (u.outputTokens ?? {});
  return {
    inputTokens: input.total ?? 0,
    outputTokens: output.total ?? 0,
    cacheReadTokens: ('cacheRead' in input ? input.cacheRead : 0) ?? 0,
    cacheWriteTokens: ('cacheWrite' in input ? input.cacheWrite : 0) ?? 0,
  };
}

function classify(error: unknown): { code: string; retryable: boolean } {
  const e = error as { name?: string; statusCode?: number; status?: number; message?: string };
  const status = e?.statusCode ?? e?.status;
  const message = String(e?.message ?? '');

  if (
    e?.name === 'AbortError' ||
    e?.name === 'TimeoutError' ||
    /abort|timed? ?out/i.test(message)
  ) {
    return { code: 'MODEL_TIMEOUT', retryable: true };
  }
  if (status === 429) return { code: 'MODEL_RATE_LIMITED', retryable: true };
  if (typeof status === 'number' && status >= 500)
    return { code: 'MODEL_UNAVAILABLE', retryable: true };
  if (typeof status === 'number' && status >= 400) {
    return { code: 'MODEL_REQUEST_INVALID', retryable: false };
  }
  return { code: 'MODEL_REQUEST_FAILED', retryable: false };
}

async function recordCall(args: {
  purpose: 'agent' | 'classifier' | 'embedding';
  model: string;
  run: RunContext | undefined;
  tenantId: string;
  usage: CallUsage;
  latencyMs: number;
  status: string;
  errorCode?: string;
}): Promise<void> {
  try {
    await withTenant(args.tenantId).llmCalls.create({
      runId: args.run?.runId ?? null,
      purpose: args.purpose,
      model: args.model,
      provider: providerName(),
      inputTokens: args.usage.inputTokens,
      outputTokens: args.usage.outputTokens,
      cacheReadTokens: args.usage.cacheReadTokens,
      cacheWriteTokens: args.usage.cacheWriteTokens,
      latencyMs: args.latencyMs,
      costUsdMicros: costUsdMicros(args.model, args.usage),
      status: args.status,
      errorCode: args.errorCode ?? null,
      createdAt: now(),
    });
  } catch (e) {
    // Losing a cost row must never fail the model call that produced it.
    logger().error({ err: e, model: args.model }, 'failed to write llm_calls row');
  }
}

export interface CallModelArgs<T> {
  purpose: 'agent' | 'classifier';
  tenantId: string;
  run?: RunContext;
  timeoutMs: number;
  fn: (model: LanguageModel, signal: AbortSignal) => Promise<T>;
  /** Pulls usage out of whatever `fn` returned. Defaults to `result.usage`. */
  usageOf?: (result: T) => unknown;
}

export async function callModel<T>(args: CallModelArgs<T>): Promise<Result<T, ModelError>> {
  const model = getModel(args.purpose);
  const modelId = (model as { modelId?: string }).modelId ?? String(model);
  const usageOf = args.usageOf ?? ((r: T) => (r as { usage?: unknown }).usage);

  let lastError: ModelError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('model call timed out')),
      args.timeoutMs,
    );

    try {
      const result = await args.fn(model, controller.signal);
      clearTimeout(timer);
      await recordCall({
        purpose: args.purpose,
        model: modelId,
        run: args.run,
        tenantId: args.tenantId,
        usage: normaliseUsage(usageOf(result)),
        latencyMs: Date.now() - startedAt,
        status: 'ok',
      });
      return ok(result);
    } catch (e) {
      clearTimeout(timer);
      const { code, retryable } = classify(e);
      await recordCall({
        purpose: args.purpose,
        model: modelId,
        run: args.run,
        tenantId: args.tenantId,
        usage: ZERO_USAGE,
        latencyMs: Date.now() - startedAt,
        status: 'failed',
        errorCode: code,
      });

      lastError = new ModelError(`${args.purpose} model call failed: ${(e as Error).message}`, {
        code,
        retryable,
        context: { model: modelId, attempt: attempt + 1 },
        cause: e,
      });

      if (!retryable) break;
      if (attempt === 0) {
        const jitter = 150 + Math.floor(Math.random() * 350);
        await new Promise((r) => setTimeout(r, jitter));
      }
    }
  }

  return err(lastError ?? new ModelError('model call failed', { code: 'MODEL_REQUEST_FAILED' }));
}

export function runDeadline(): Date {
  return new Date(now().getTime() + serverEnv().KORA_RUN_DEADLINE_MS);
}

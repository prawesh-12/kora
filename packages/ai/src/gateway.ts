import {
  ModelError,
  RETRY_POLICY,
  type Result,
  TIMEOUT_BUDGET_MS,
  backoffMs,
  err,
  isRetryable,
  logger,
  now,
  ok,
  serverEnv,
} from '@kora/core';
import { withTenant } from '@kora/db';
import { breaker, modelBreakerKey } from '@kora/tools';
import type { LanguageModel } from 'ai';
import { fallbackModelFor } from './fallback.js';
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
  provider?: string;
}): Promise<void> {
  try {
    await withTenant(args.tenantId).llmCalls.create({
      runId: args.run?.runId ?? null,
      purpose: args.purpose,
      model: args.model,
      provider: args.provider ?? providerName(),
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

interface ModelTarget {
  model: LanguageModel;
  modelId: string;
  provider: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function attemptCall<T>(
  args: CallModelArgs<T>,
  target: ModelTarget,
  timeoutMs: number,
  attempt: number,
  usageOf: (result: T) => unknown,
): Promise<Result<T, ModelError>> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('model call timed out')), timeoutMs);

  try {
    const result = await args.fn(target.model, controller.signal);
    clearTimeout(timer);
    await recordCall({
      purpose: args.purpose,
      model: target.modelId,
      provider: target.provider,
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
      model: target.modelId,
      provider: target.provider,
      run: args.run,
      tenantId: args.tenantId,
      usage: ZERO_USAGE,
      latencyMs: Date.now() - startedAt,
      status: 'failed',
      errorCode: code,
    });
    return err(
      new ModelError(`${args.purpose} model call failed: ${(e as Error).message}`, {
        code,
        retryable,
        context: { model: target.modelId, attempt },
        cause: e,
      }),
    );
  }
}

export async function callModel<T>(args: CallModelArgs<T>): Promise<Result<T, ModelError>> {
  const usageOf = args.usageOf ?? ((r: T) => (r as { usage?: unknown }).usage);
  // The caller may ask for less than the model-call budget but never for more.
  const timeoutMs = Math.min(args.timeoutMs, TIMEOUT_BUDGET_MS.modelCall);
  const policy = RETRY_POLICY.model_call;

  const model = getModel(args.purpose);
  const primary: ModelTarget = {
    model,
    modelId: (model as { modelId?: string }).modelId ?? String(model),
    provider: providerName(),
  };
  const breakerKey = modelBreakerKey(primary.provider);

  let lastError: ModelError | null = null;
  const gate = await breaker().gate(breakerKey, 'read');

  if (gate.pass) {
    for (let i = 0; i < policy.attempts; i++) {
      const result = await attemptCall(args, primary, timeoutMs, i + 1, usageOf);
      if (result.ok) {
        await breaker().recordSuccess(breakerKey);
        return result;
      }
      lastError = result.error;
      if (!isRetryable('model_call', result.error)) break;
      if (i < policy.attempts - 1) await sleep(backoffMs(policy, i + 1));
    }
    if (lastError && isRetryable('model_call', lastError)) {
      await breaker().recordFailure(breakerKey);
    }
  } else {
    lastError = new ModelError(
      `the ${primary.provider} provider is failing, so calls to it are paused`,
      { code: 'MODEL_UNAVAILABLE', retryable: true, context: { provider: primary.provider } },
    );
  }

  if (!lastError) return err(new ModelError('model call failed', { code: 'MODEL_REQUEST_FAILED' }));
  if (!isRetryable('model_call', lastError)) return err(lastError);

  let fallback: ReturnType<typeof fallbackModelFor>;
  try {
    fallback = fallbackModelFor(args.purpose);
  } catch (e) {
    logger().error({ err: e }, 'the configured agent fallback model cannot be used');
    return err(lastError);
  }
  if (!fallback) return err(lastError);

  // A silent fallback hides a provider outage. This marker and the `fallback:` prefix
  // on the `llm_calls` provider column are what make it visible afterwards.
  logger().warn(
    {
      code: 'model.fallback_used',
      primary: primary.modelId,
      fallback: fallback.modelId,
      tenantId: args.tenantId,
      runId: args.run?.runId ?? null,
      cause: lastError.code,
    },
    'model.fallback_used: the primary agent model failed and the fallback provider answered instead',
  );

  const target: ModelTarget = { ...fallback, provider: `fallback:${fallback.provider}` };
  const fallbackKey = modelBreakerKey(target.provider);
  const attempted = await attemptCall(args, target, timeoutMs, policy.attempts + 1, usageOf);
  if (attempted.ok) {
    await breaker().recordSuccess(fallbackKey);
    return attempted;
  }
  if (isRetryable('model_call', attempted.error)) await breaker().recordFailure(fallbackKey);
  return err(attempted.error);
}

export function runDeadline(): Date {
  return new Date(now().getTime() + serverEnv().KORA_RUN_DEADLINE_MS);
}

import { now } from './clock.js';
import { KoraError, ValidationError } from './errors.js';

export type RetryClass =
  | 'model_call'
  | 'read_tool'
  | 'idempotent_write'
  | 'non_idempotent_write'
  | 'embedding_batch'
  | 'queue_job';

export interface RetryPolicy {
  attempts: number;
  backoff: 'exponential' | 'linear' | 'none';
  baseMs: number;
}

/** The one retry table. Every layer reads its numbers from here. */
export const RETRY_POLICY: Record<RetryClass, RetryPolicy> = {
  model_call: { attempts: 2, backoff: 'exponential', baseMs: 250 },
  read_tool: { attempts: 3, backoff: 'exponential', baseMs: 250 },
  idempotent_write: { attempts: 2, backoff: 'exponential', baseMs: 250 },
  non_idempotent_write: { attempts: 1, backoff: 'none', baseMs: 0 },
  embedding_batch: { attempts: 2, backoff: 'linear', baseMs: 500 },
  queue_job: { attempts: 5, backoff: 'exponential', baseMs: 2000 },
};

export const BACKOFF_CAP_MS = 30_000;

/**
 * Full jitter: a uniform pick from `[0, ceiling)` rather than the ceiling itself.
 * Every failed caller waking at the same instant is what turns one outage into two.
 */
export function backoffMs(policy: RetryPolicy, attempt: number): number {
  if (policy.backoff === 'none') return 0;
  const raw =
    policy.backoff === 'exponential' ? policy.baseMs * 2 ** attempt : policy.baseMs * attempt;
  const ceiling = Math.min(Math.max(raw, 0), BACKOFF_CAP_MS);
  return Math.floor(Math.random() * ceiling);
}

const NEVER_RETRY_CODES = new Set([
  'UPSTREAM_4XX',
  'MODEL_REQUEST_INVALID',
  'INVALID_INPUT',
  'VALIDATION_ERROR',
  'INVALID_ENV',
]);

function httpStatus(error: unknown): number | undefined {
  const e = error as
    | { statusCode?: unknown; status?: unknown; context?: { status?: unknown } }
    | undefined;
  for (const candidate of [e?.statusCode, e?.status, e?.context?.status]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}

function isValidationFailure(error: unknown): boolean {
  if (error instanceof ValidationError) return true;
  const code = (error as KoraError | undefined)?.code;
  return typeof code === 'string' && NEVER_RETRY_CODES.has(code);
}

export function isRetryable(retryClass: RetryClass, error: unknown): boolean {
  if (RETRY_POLICY[retryClass].attempts <= 1) return false;
  if (retryClass === 'queue_job') return !isValidationFailure(error);

  const status = httpStatus(error);
  if (status !== undefined && status >= 400 && status < 500) {
    return retryClass === 'model_call' && status === 429;
  }
  if (isValidationFailure(error)) return false;
  if (error instanceof KoraError) return error.retryable;
  return true;
}

/**
 * The budget is spent top down: an inner layer may only shrink what the layer above
 * handed it. A tool call has no constant here because each tool declares its own.
 */
export const TIMEOUT_BUDGET_MS = {
  request: 60_000,
  agentRun: 45_000,
  modelCall: 20_000,
} as const;

export function budgetedTimeoutMs(declaredMs: number, deadlineAt: Date): number {
  return Math.min(declaredMs, Math.max(0, deadlineAt.getTime() - now().getTime()));
}

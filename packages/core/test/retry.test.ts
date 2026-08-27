import { describe, expect, it } from 'vitest';
import { setTestClock } from '../src/clock.js';
import { KoraError, ToolError, ValidationError } from '../src/errors.js';
import {
  BACKOFF_CAP_MS,
  RETRY_POLICY,
  TIMEOUT_BUDGET_MS,
  backoffMs,
  budgetedTimeoutMs,
  isRetryable,
} from '../src/retry.js';

describe('RETRY_POLICY', () => {
  it('matches the agreed table field by field', () => {
    expect(RETRY_POLICY.model_call).toEqual({
      attempts: 2,
      backoff: 'exponential',
      baseMs: 250,
    });
    expect(RETRY_POLICY.read_tool).toEqual({ attempts: 3, backoff: 'exponential', baseMs: 250 });
    expect(RETRY_POLICY.idempotent_write).toEqual({
      attempts: 2,
      backoff: 'exponential',
      baseMs: 250,
    });
    expect(RETRY_POLICY.non_idempotent_write).toEqual({
      attempts: 1,
      backoff: 'none',
      baseMs: 0,
    });
    expect(RETRY_POLICY.embedding_batch).toEqual({ attempts: 2, backoff: 'linear', baseMs: 500 });
    expect(RETRY_POLICY.queue_job).toEqual({ attempts: 5, backoff: 'exponential', baseMs: 2000 });
  });
});

describe('backoffMs', () => {
  it('stays non-negative and under the cap for every class and a long attempt run', () => {
    for (const policy of Object.values(RETRY_POLICY)) {
      for (let attempt = 0; attempt <= 40; attempt++) {
        for (let i = 0; i < 20; i++) {
          const wait = backoffMs(policy, attempt);
          expect(wait).toBeGreaterThanOrEqual(0);
          expect(wait).toBeLessThanOrEqual(BACKOFF_CAP_MS);
        }
      }
    }
  });

  it('never waits for a class that does not retry', () => {
    expect(backoffMs(RETRY_POLICY.non_idempotent_write, 3)).toBe(0);
  });

  it('grows the ceiling exponentially and jitters below it', () => {
    const samples = Array.from({ length: 200 }, () => backoffMs(RETRY_POLICY.read_tool, 2));
    expect(Math.max(...samples)).toBeLessThan(1000);
    expect(Math.min(...samples)).toBeLessThan(Math.max(...samples));
  });
});

describe('isRetryable', () => {
  const notFound = new ToolError('acme returned 404', {
    code: 'UPSTREAM_4XX',
    retryable: false,
    context: { status: 404 },
  });
  const serverError = new ToolError('acme returned 500', {
    code: 'UPSTREAM_5XX',
    retryable: true,
    context: { status: 500 },
  });

  it('never retries a non-idempotent write, whatever the error', () => {
    expect(isRetryable('non_idempotent_write', serverError)).toBe(false);
    expect(isRetryable('non_idempotent_write', new Error('connection reset'))).toBe(false);
  });

  it('retries a 429 for a model call but not for a read tool', () => {
    const rateLimited = Object.assign(new Error('slow down'), { statusCode: 429 });
    expect(isRetryable('model_call', rateLimited)).toBe(true);
    expect(isRetryable('read_tool', rateLimited)).toBe(false);
  });

  it('never retries a 4xx', () => {
    for (const cls of ['model_call', 'read_tool', 'idempotent_write', 'embedding_batch'] as const) {
      expect(isRetryable(cls, notFound)).toBe(false);
      expect(isRetryable(cls, Object.assign(new Error('bad request'), { statusCode: 400 }))).toBe(
        false,
      );
    }
  });

  it('retries a 5xx and a timeout', () => {
    expect(isRetryable('read_tool', serverError)).toBe(true);
    expect(
      isRetryable(
        'idempotent_write',
        new KoraError('timed out', { code: 'UPSTREAM_TIMEOUT', retryable: true }),
      ),
    ).toBe(true);
  });

  it('retries a queue job unless it failed validation', () => {
    expect(isRetryable('queue_job', new Error('redis went away'))).toBe(true);
    expect(
      isRetryable('queue_job', new ValidationError('bad payload', { code: 'INVALID_INPUT' })),
    ).toBe(false);
  });
});

describe('budgetedTimeoutMs', () => {
  it('never returns more than the deadline leaves, and never a negative wait', () => {
    setTestClock(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const deadline = new Date(Date.parse('2026-01-01T00:00:00.000Z') + 3000);
      expect(budgetedTimeoutMs(10_000, deadline)).toBe(3000);
      expect(budgetedTimeoutMs(1000, deadline)).toBe(1000);
      expect(budgetedTimeoutMs(10_000, new Date(Date.parse('2025-12-31T23:59:00.000Z')))).toBe(0);
    } finally {
      setTestClock(null);
    }
  });

  it('spends the budget top down', () => {
    expect(TIMEOUT_BUDGET_MS.request).toBeGreaterThan(TIMEOUT_BUDGET_MS.agentRun);
    expect(TIMEOUT_BUDGET_MS.agentRun).toBeGreaterThan(TIMEOUT_BUDGET_MS.modelCall);
  });
});

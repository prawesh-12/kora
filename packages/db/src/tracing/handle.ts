import {
  type AgentState,
  type DeploymentMode,
  type RunOutcome,
  type RunStepKind,
  logger,
  newId,
  now,
} from '@kora/core';
import { createRepositories } from '../repositories/index.js';
import type { RunHandle } from './types.js';

export async function startRun(input: {
  tenantId: string;
  conversationId: string;
  agentConfigVersion: string;
  agentVersionId?: string | null;
  triggerMessageId?: string;
  deploymentMode?: DeploymentMode;
}): Promise<RunHandle> {
  const repos = createRepositories(input.tenantId);
  const traceId = newId('tr');
  const run = await repos.runs.create({
    conversationId: input.conversationId,
    traceId,
    agentConfigVersion: input.agentConfigVersion,
    agentVersionId: input.agentVersionId ?? null,
    triggerMessageId: input.triggerMessageId ?? null,
    deploymentMode: input.deploymentMode ?? 'full',
    startedAt: now(),
  });

  const log = logger().child({ traceId, tenantId: input.tenantId, runId: run.id });

  // Ordinals come from an in-memory counter, not a row count. Concurrent step
  // writes would race on a count and produce duplicates.
  let ordinal = 0;
  let state: AgentState = 'NEW';
  let finished = false;

  const nextOrdinal = () => ordinal++;

  const handle: RunHandle = {
    runId: run.id,
    traceId,
    tenantId: input.tenantId,
    conversationId: input.conversationId,

    async record(
      kind: RunStepKind,
      payload: Record<string, unknown>,
      status = 'ok',
      durationMs?: number,
    ) {
      const row = await repos.steps.create({
        runId: run.id,
        ordinal: nextOrdinal(),
        kind,
        payload,
        status,
        startedAt: now(),
        // Null, not zero: a marker step has no span, so it made no timing claim.
        durationMs: durationMs ?? null,
      });
      return row.id;
    },

    async step<T>(
      kind: RunStepKind,
      payload: Record<string, unknown>,
      fn: (stepId: string) => Promise<T>,
    ) {
      const startedAt = now();
      const row = await repos.steps.create({
        runId: run.id,
        ordinal: nextOrdinal(),
        kind,
        payload,
        status: 'running',
        startedAt,
      });
      try {
        const value = await fn(row.id);
        await repos.steps.patch(row.id, {
          status: 'ok',
          durationMs: now().getTime() - startedAt.getTime(),
        });
        return value;
      } catch (e) {
        await repos.steps.patch(row.id, {
          status: 'failed',
          durationMs: now().getTime() - startedAt.getTime(),
          payload: { ...payload, error: (e as Error).message },
        });
        throw e;
      }
    },

    currentState: () => state,

    async setState(next: AgentState) {
      state = next;
      await repos.steps.create({
        runId: run.id,
        ordinal: nextOrdinal(),
        kind: 'state',
        payload: { state: next },
        status: 'ok',
        startedAt: now(),
        // A state transition is an instant, not a span.
        durationMs: null,
      });
      await repos.conversations.setState(input.conversationId, next);
    },

    async finish(outcome: RunOutcome, finalState: AgentState) {
      if (finished) {
        log.warn('finish() called twice on the same run handle, ignoring the second call');
        return;
      }
      finished = true;
      const totals = await repos.llmCalls.totalsForRun(run.id);
      await repos.runs.patch(run.id, {
        finishedAt: now(),
        durationMs: now().getTime() - run.startedAt.getTime(),
        stepCount: ordinal,
        outcome,
        finalState,
        tokenInput: totals.tokensIn,
        tokenOutput: totals.tokensOut,
        costUsdMicros: totals.costUsdMicros,
      });
      await repos.conversations.patch(input.conversationId, { outcome });
    },
  };

  return handle;
}

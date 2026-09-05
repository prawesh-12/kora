import { childLogger, now, serverEnv } from '@kora/core';
import { emit } from '@kora/db';
import type { EventJob } from '../queues.js';

/**
 * `evaluations.run_id` is unique, so a re-delivery after a worker is killed mid-job
 * produces the same single row.
 */
export async function evaluateRunJob(job: EventJob): Promise<void> {
  const { runId, tenantId, traceId } = job.payload as {
    runId: string;
    tenantId: string;
    traceId: string;
  };
  const log = childLogger({ runId, tenantId, traceId, job: 'evaluate-run' });

  const { evaluateRun } = await import('@kora/evaluation');
  const { makeJudgeCaller } = await import('@kora/ai');

  const sampleRate = serverEnv().KORA_JUDGE_SAMPLE_RATE;
  const outcome = (job.payload as { outcome?: string }).outcome;

  // Every escalated or failed run is judged. Clean resolutions are sampled,
  // because they are the ones where the deterministic checks already agree.
  const alwaysJudge = outcome !== 'resolved_automatically';
  const judge =
    alwaysJudge || Math.random() < sampleRate
      ? { call: makeJudgeCaller(tenantId, runId) }
      : undefined;

  const record = await evaluateRun({ tenantId, runId, ...(judge ? { judge } : {}) });
  log.info({ verifiedResolution: record.verifiedResolution }, 'run evaluated');

  await emit('evaluation.completed', {
    tenantId,
    traceId,
    runId,
    conversationId: (job.payload as { conversationId: string }).conversationId,
    verifiedResolution: record.verifiedResolution,
    occurredAt: now(),
  });
}

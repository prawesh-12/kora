import { ValidationError } from '@kora/core';
import { createRepositories } from '../repositories/index.js';
import type { AssembledTrace, RetrievalStepPayload } from './types.js';

export async function assembleTrace(tenantId: string, runId: string): Promise<AssembledTrace> {
  const repos = createRepositories(tenantId);

  const run = await repos.runs.get(runId);
  if (!run) {
    // A run belonging to another tenant looks exactly like one that does not exist.
    throw new ValidationError(`run ${runId} not found`, {
      code: 'RUN_NOT_FOUND',
      context: { runId, tenantId },
    });
  }

  // Nine small indexed queries, not one multi-way join. Faster, and far easier to change.
  const [
    conversation,
    messages,
    steps,
    toolExecutions,
    policyChecks,
    approvals,
    escalation,
    llmCalls,
  ] = await Promise.all([
    repos.conversations.get(run.conversationId),
    repos.messages.listForConversation(run.conversationId),
    repos.steps.listForRun(runId),
    repos.toolExecutions.listForRun(runId),
    repos.policyChecks.listForRun(runId),
    repos.approvals.listForRun(runId),
    repos.escalations.forRun(runId),
    repos.llmCalls.listForRun(runId),
  ]);

  if (!conversation) {
    throw new ValidationError(`run ${runId} not found`, {
      code: 'RUN_NOT_FOUND',
      context: { runId, tenantId },
    });
  }

  const retrievals = steps
    .filter((s) => s.kind === 'retrieval')
    .map((s) => ({ stepId: s.id, ...(s.payload as object) }) as RetrievalStepPayload);

  const tokensIn = llmCalls.reduce((n, c) => n + c.inputTokens, 0);
  const tokensOut = llmCalls.reduce((n, c) => n + c.outputTokens, 0);
  const costUsdMicros = llmCalls.reduce((n, c) => n + Number(c.costUsdMicros ?? 0), 0);

  return {
    run,
    conversation: { row: conversation, messages },
    steps,
    toolExecutions,
    policyChecks,
    approvals,
    escalation,
    llmCalls,
    retrievals,
    totals: {
      durationMs: run.durationMs ?? steps.reduce((n, s) => n + (s.durationMs ?? 0), 0),
      tokensIn,
      tokensOut,
      costUsdMicros,
    },
  };
}

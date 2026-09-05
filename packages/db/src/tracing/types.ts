import type { AgentState, RunOutcome, RunStepKind } from '@kora/core';
import type * as s from '../schema/index.js';

export type AgentRunRow = typeof s.agentRuns.$inferSelect;
export type ConversationRow = typeof s.conversations.$inferSelect;
export type MessageRow = typeof s.messages.$inferSelect;
export type RunStepRow = typeof s.runSteps.$inferSelect;
export type ToolExecutionRow = typeof s.toolExecutions.$inferSelect;
export type PolicyCheckRow = typeof s.policyChecks.$inferSelect;
export type ApprovalRow = typeof s.approvals.$inferSelect;
export type EscalationRow = typeof s.escalations.$inferSelect;
export type LlmCallRow = typeof s.llmCalls.$inferSelect;

export interface RetrievalStepPayload {
  stepId: string;
  query: string;
  filters: Record<string, unknown>;
  chunks: Array<{
    chunkId: string;
    documentId: string;
    documentVersion: number;
    title: string;
    headingPath: string;
    content: string;
    distance: number;
  }>;
  error?: string;
}

export interface AssembledTrace {
  run: AgentRunRow;
  conversation: { row: ConversationRow; messages: MessageRow[] };
  steps: RunStepRow[];
  toolExecutions: ToolExecutionRow[];
  policyChecks: PolicyCheckRow[];
  approvals: ApprovalRow[];
  escalation: EscalationRow | null;
  llmCalls: LlmCallRow[];
  retrievals: RetrievalStepPayload[];
  totals: { durationMs: number; tokensIn: number; tokensOut: number; costUsdMicros: number };
}

export interface RunHandle {
  runId: string;
  traceId: string;
  tenantId: string;
  conversationId: string;
  step<T>(
    kind: RunStepKind,
    payload: Record<string, unknown>,
    fn: (stepId: string) => Promise<T>,
  ): Promise<T>;
  /**
   * `durationMs` is optional because most steps are markers with no span to measure.
   * Leaving it out stores null, not zero: zero would claim the step took no time.
   */
  record(
    kind: RunStepKind,
    payload: Record<string, unknown>,
    status?: string,
    durationMs?: number,
  ): Promise<string>;
  setState(state: AgentState): Promise<void>;
  currentState(): AgentState;
  finish(outcome: RunOutcome, finalState: AgentState): Promise<void>;
}

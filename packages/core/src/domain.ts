export type SideEffect = 'read' | 'write_low' | 'write_high';

export type AgentState =
  | 'NEW'
  | 'IDENTIFYING_INTENT'
  | 'GATHERING_CONTEXT'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'WAITING_FOR_TOOL'
  | 'VERIFYING'
  | 'RESPONDING'
  | 'RESOLVED'
  | 'ACTION_FAILED'
  | 'NEEDS_HUMAN';

export type Intent =
  | 'ORDER_STATUS'
  | 'DAMAGED_ORDER'
  | 'CANCEL_ORDER'
  | 'REFUND_REQUEST'
  | 'HUMAN_REQUEST'
  | 'OUT_OF_SCOPE';

export const INTENTS: readonly Intent[] = [
  'ORDER_STATUS',
  'DAMAGED_ORDER',
  'CANCEL_ORDER',
  'REFUND_REQUEST',
  'HUMAN_REQUEST',
  'OUT_OF_SCOPE',
];

/** Intents that can never lead to a write, whatever the model proposes. */
export const READ_ONLY_INTENTS: readonly Intent[] = ['ORDER_STATUS'];

/** Intents that hand over immediately, with no context gathering at all. */
export const HANDOVER_INTENTS: readonly Intent[] = ['HUMAN_REQUEST', 'OUT_OF_SCOPE'];

export type PolicyDecision = 'allow' | 'deny' | 'require_approval';

export type RunOutcome = 'resolved_automatically' | 'escalated' | 'failed' | 'abandoned';

export type EscalationReason =
  | 'LOW_CONFIDENCE'
  | 'POLICY_REQUIRES_HUMAN'
  | 'POLICY_DENIED'
  | 'TOOL_FAILED'
  | 'VERIFICATION_FAILED'
  | 'CUSTOMER_REQUESTED'
  | 'UNSUPPORTED_SCENARIO'
  | 'APPROVAL_DENIED'
  | 'MAX_STEPS_REACHED';

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED'
  | 'POLICY_DENIED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_5XX'
  | 'UPSTREAM_4XX'
  | 'MALFORMED_OUTPUT'
  | 'VERIFY_FAILED'
  | 'DEADLINE_EXCEEDED'
  | 'TOOL_SELECTION_FAILURE';

export type RunStepKind =
  | 'intent'
  | 'retrieval'
  | 'model'
  | 'tool'
  | 'policy'
  | 'approval'
  | 'verify'
  | 'response'
  | 'state';

export type DeploymentMode = 'simulation' | 'human_approval' | 'full';

export const AGENT_STATES: readonly AgentState[] = [
  'NEW',
  'IDENTIFYING_INTENT',
  'GATHERING_CONTEXT',
  'PLANNING',
  'AWAITING_APPROVAL',
  'WAITING_FOR_TOOL',
  'VERIFYING',
  'RESPONDING',
  'RESOLVED',
  'ACTION_FAILED',
  'NEEDS_HUMAN',
];

export const TERMINAL_STATES: readonly AgentState[] = ['RESOLVED', 'NEEDS_HUMAN'];

export function isTerminalState(s: AgentState): boolean {
  return TERMINAL_STATES.includes(s);
}

/**
 * Why a run failed, from Appendix C. The order of this list is the order the
 * classifier walks: root cause first, symptom last.
 */
export type FailureCode =
  | 'STATE_FAILURE'
  | 'INTENT_FAILURE'
  | 'RETRIEVAL_FAILURE'
  | 'KNOWLEDGE_FAILURE'
  | 'TOOL_SELECTION_FAILURE'
  | 'ARGUMENT_FAILURE'
  | 'POLICY_FAILURE'
  | 'TOOL_EXECUTION_FAILURE'
  | 'OUTCOME_FAILURE'
  | 'HALLUCINATION'
  | 'ESCALATION_FAILURE'
  | 'LATENCY_FAILURE';

export const FAILURE_CODES: readonly FailureCode[] = [
  'STATE_FAILURE',
  'INTENT_FAILURE',
  'RETRIEVAL_FAILURE',
  'KNOWLEDGE_FAILURE',
  'TOOL_SELECTION_FAILURE',
  'ARGUMENT_FAILURE',
  'POLICY_FAILURE',
  'TOOL_EXECUTION_FAILURE',
  'OUTCOME_FAILURE',
  'HALLUCINATION',
  'ESCALATION_FAILURE',
  'LATENCY_FAILURE',
];

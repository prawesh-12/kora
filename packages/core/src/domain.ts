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

export type Intent = 'DAMAGED_ORDER' | 'HUMAN_REQUEST' | 'OUT_OF_SCOPE';

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

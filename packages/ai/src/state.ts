import { type AgentState, KoraError } from '@kora/core';

export const TRANSITIONS: Record<AgentState, AgentState[]> = {
  NEW: ['IDENTIFYING_INTENT'],
  IDENTIFYING_INTENT: ['GATHERING_CONTEXT', 'NEEDS_HUMAN'],
  GATHERING_CONTEXT: ['PLANNING', 'NEEDS_HUMAN', 'RESPONDING'],
  PLANNING: ['WAITING_FOR_TOOL', 'AWAITING_APPROVAL', 'RESPONDING', 'NEEDS_HUMAN'],
  AWAITING_APPROVAL: ['WAITING_FOR_TOOL', 'NEEDS_HUMAN'],
  WAITING_FOR_TOOL: ['VERIFYING', 'ACTION_FAILED'],
  VERIFYING: ['RESPONDING', 'NEEDS_HUMAN'],
  ACTION_FAILED: ['WAITING_FOR_TOOL', 'NEEDS_HUMAN'],
  RESPONDING: ['RESOLVED', 'NEEDS_HUMAN'],
  RESOLVED: ['IDENTIFYING_INTENT'],
  NEEDS_HUMAN: [],
};

export class IllegalTransitionError extends KoraError {}

export function canTransition(from: AgentState, to: AgentState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * An illegal transition throws. It is a bug in the orchestrator, not a handled
 * outcome, and a run that reaches an impossible state must fail loudly.
 */
export function assertTransition(from: AgentState, to: AgentState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(`cannot move from ${from} to ${to}`, {
      code: 'ILLEGAL_STATE_TRANSITION',
      context: { from, to, allowed: TRANSITIONS[from] },
    });
  }
}

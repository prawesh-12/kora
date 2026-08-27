import type { Intent, PolicyDecision } from '../domain.js';

export interface PolicyFacts {
  intent?: Intent;
  action: string;
  amountMinor?: number;
  currency?: string;
  orderStatus?: string;
  itemCategory?: string;
  daysSinceDelivery?: number;
  alreadyReplaced?: boolean;
  /** Refund facts, all derived from the order record. */
  orderTotalMinor?: number;
  refundedAmountMinor?: number;
  requestedAmountMinor?: number;
  fullyRefunded?: boolean;
  exceedsRemaining?: boolean;
  channel: 'web';
  [k: string]: unknown;
}

export interface PolicyResult {
  decision: PolicyDecision;
  policyKey: string;
  policyVersion: string;
  ruleId: string;
  reason: string;
  factsUsed: Record<string, unknown>;
  missingFacts: string[];
  evaluatedAt: Date;
}

export type Operator = 'eq' | 'neq' | 'in' | 'notIn' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists';

export interface Condition {
  fact: string;
  op: Operator;
  value: unknown;
}

export interface CompiledRule {
  id: string;
  /** Which file in the bundle this rule came from, so a check names its source. */
  policyKey: string;
  policyVersion: string;
  decision: PolicyDecision;
  reason: string;
  conditions: Condition[];
}

export interface CompiledPolicy {
  key: string;
  version: string;
  description: string;
  currency: string;
  default: PolicyDecision;
  rules: CompiledRule[];
  /** One entry per file in the bundle, in the order they are checked. */
  sources: Array<{ key: string; version: string }>;
}

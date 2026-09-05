import type { FailureCode } from '@kora/core';
import type { AssembledTrace, RefundRecord, SubscriptionRecord } from './deps.js';

/** The refunds and subscriptions a run touched, read back from the billing provider. */
export interface ExternalStateSnapshot {
  refunds: Record<string, RefundRecord>;
  subscriptions: Record<string, SubscriptionRecord>;
  fetchedAt: Date;
  /** Set when the provider could not be read. Checks that need it return CANNOT_ASSESS. */
  error?: string;
}

export interface ScenarioExpectation {
  state?: string;
  intent?: string;
  tools?: string[];
  forbiddenTools?: string[];
  policyDecision?: string | null;
  evaluation?: {
    verifiedResolution: boolean;
    checks: Record<string, 'MET' | 'UNMET' | 'CANNOT_ASSESS'>;
  };
  responseMustContain?: string[];
  responseMustNotContain?: string[];
}

export interface ScenarioSpec {
  id: string;
  name: string;
  category?: string;
  input: string;
  followUps?: string[];
  seed: {
    customerId?: string;
    customerKey?: string;
    subscriptionKey?: string;
    chargeKey?: string;
    invoiceKey?: string;
  };
  faults: Array<{ onTool: string; fault: string; times?: number }>;
  emptyKnowledge?: boolean;
  deploymentMode?: 'simulation' | 'human_approval' | 'full';
  expect: ScenarioExpectation;
}

export interface EvaluationInput {
  trace: AssembledTrace;
  externalState: ExternalStateSnapshot;
  scenario?: ScenarioSpec | undefined;
  /** Set for classification, which reads the verdicts rather than recomputing them. */
  checks?: CheckResult[] | undefined;
}

export type Verdict = 'MET' | 'UNMET' | 'CANNOT_ASSESS';

export interface CheckResult {
  id: string;
  verdict: Verdict;
  critical: boolean;
  evidence: string;
}

export type Check = (input: EvaluationInput) => CheckResult;

export interface EvaluationRecord {
  id: string;
  tenantId: string;
  runId: string;
  agentConfigVersion: string;
  verifiedResolution: boolean;
  checks: CheckResult[];
  failures: Array<{ code: FailureCode; detail: string; evidence: string }>;
  createdAt: Date;
}

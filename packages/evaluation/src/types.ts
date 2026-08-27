import type { FailureCode } from '@kora/core';
import type { AssembledTrace, OrderResponse, ReplacementResponse } from './deps.js';

export interface ExternalStateSnapshot {
  orders: Record<string, OrderResponse>;
  replacementsByOrder: Record<string, ReplacementResponse[]>;
  fetchedAt: Date;
  /** Set when Acme could not be read. Checks that need it return CANNOT_ASSESS. */
  error?: string;
}

export interface ScenarioExpectation {
  state?: string;
  intent?: string;
  tools?: string[];
  forbiddenTools?: string[];
  policyDecision?: string | null;
  externalState?: { replacementsForOrder?: number; orderStatus?: string };
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
  input: string;
  seed: { orderId?: string; customerId?: string };
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

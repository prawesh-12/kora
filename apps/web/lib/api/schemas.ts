import type { AgentState, EscalationReason, FailureCode, Intent, RunOutcome } from '@kora/core';
import { FAILURE_CODES, INTENTS, now } from '@kora/core';
import type { TurnResult } from '@kora/ai';
import type {
  AssembledTrace,
  ConversationSummary,
  FailureBucket,
  Metrics,
  QueuedApproval,
  VrrPoint,
} from '@kora/db';
import { z } from 'zod';
import { badRequest } from './errors';

export const CreateConversationRequest = z.object({
  externalCustomerId: z.string().min(1).max(200).optional(),
});

export const SendMessageRequest = z.object({
  message: z.string().min(1).max(4000),
});

export const ApprovalDecisionRequest = z.object({
  decision: z.enum(['approved', 'denied']),
  note: z.string().max(2000).optional(),
});

const OUTCOMES = [
  'resolved_automatically',
  'escalated',
  'failed',
  'abandoned',
] as const satisfies readonly RunOutcome[];

function literals<T extends string>(values: readonly T[]) {
  return z.enum(values as unknown as [T, ...T[]]);
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const MetricsQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  intent: literals(INTENTS).optional(),
  agentConfigVersion: z.string().min(1).max(200).optional(),
});

export const ConversationsQuery = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  intent: literals(INTENTS).optional(),
  outcome: literals(OUTCOMES).optional(),
  failureCode: literals(FAILURE_CODES).optional(),
  verified: bool.optional(),
  escalated: bool.optional(),
  escalationStatus: z.enum(['open', 'closed']).optional(),
});

export const ApprovalsQuery = z.object({
  status: z.enum(['pending', 'decided', 'expired', 'all']).default('pending'),
  scope: z.enum(['today']).optional(),
  tool: z.string().min(1).max(100).optional(),
  minValueMinor: z.coerce.number().int().min(0).optional(),
  maxValueMinor: z.coerce.number().int().min(1).optional(),
});

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The cap is the whole reason live aggregation is safe without a rollup table.
 * A wider range is refused rather than allowed to scan the table and time out.
 */
export function resolveWindow(
  from: Date | undefined,
  to: Date | undefined,
): {
  from: Date;
  to: Date;
} {
  const until = to ?? now();
  const since = from ?? new Date(until.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

  if (since.getTime() > until.getTime()) throw badRequest('`from` must not be after `to`');
  if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    throw badRequest(`the range must be ${MAX_WINDOW_DAYS} days or less`);
  }
  return { from: since, to: until };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('the request body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

export function parseQuery<T extends z.ZodType>(url: string, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(url).searchParams);
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface MessageDto {
  id: string;
  role: 'customer' | 'agent' | 'system' | 'human_agent';
  content: string;
  parts: unknown[];
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  state: AgentState;
  intent: Intent | null;
  outcome: RunOutcome | null;
  channel: string;
  startedAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
}

export interface ConversationDetailDto {
  conversation: ConversationDto;
  messages: MessageDto[];
  latestRunId: string | null;
  pendingApprovalId: string | null;
}

export interface TurnDto {
  runId: string;
  traceId: string;
  conversationId: string;
  finalState: AgentState;
  outcome: RunOutcome;
  intent: Intent | null;
  text: string;
  toolsCalled: string[];
  approvalId: string | null;
  escalationReason: EscalationReason | null;
}

export interface ApprovalDto {
  id: string;
  runId: string;
  conversationId: string;
  toolName: string;
  proposedInput: unknown;
  reason: string;
  ruleId: string | null;
  policyVersion: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  amountMinor: number | null;
  currency: string | null;
}

export interface VrrPointDto {
  day: string;
  runs: number;
  evaluated: number;
  verified: number;
  rate: number | null;
}

export interface MetricsDto {
  window: { from: string; to: string };
  runs: { total: number; eligible: number; evaluated: number; pending: number };
  coverage: { inScope: number; outOfScope: number; humanRequest: number; rate: number | null };
  automationRate: number | null;
  escalationRate: number | null;
  verifiedResolutionRate: number | null;
  verifiedResolutions: number;
  policyComplianceRate: number | null;
  toolSuccessRate: number | null;
  groundingRate: number | null;
  latencyMs: { p50: number | null; p95: number | null };
  totalCostUsdMicros: number;
  costPerResolutionUsdMicros: number | null;
  trend: VrrPointDto[];
}

export function toMetricsDto(metrics: Metrics, trend: VrrPoint[]): MetricsDto {
  return {
    window: metrics.window,
    runs: metrics.runs,
    coverage: metrics.coverage,
    automationRate: metrics.automationRate,
    escalationRate: metrics.escalationRate,
    verifiedResolutionRate: metrics.verifiedResolutionRate,
    verifiedResolutions: metrics.verifiedResolutions,
    policyComplianceRate: metrics.policyComplianceRate,
    toolSuccessRate: metrics.toolSuccessRate,
    groundingRate: metrics.groundingRate,
    latencyMs: metrics.latencyMs,
    totalCostUsdMicros: metrics.totalCostUsdMicros,
    costPerResolutionUsdMicros: metrics.costPerResolutionUsdMicros,
    trend: trend.map((p) => ({
      day: p.day,
      runs: p.runs,
      evaluated: p.evaluated,
      verified: p.verified,
      rate: p.rate,
    })),
  };
}

export interface FailureBucketDto {
  code: FailureCode;
  count: number;
  topDetail: string;
}

export function toFailureBucketDto(b: FailureBucket): FailureBucketDto {
  return { code: b.code, count: b.count, topDetail: b.topDetail };
}

export interface ConversationSummaryDto {
  runId: string;
  conversationId: string;
  customer: string | null;
  startedAt: string;
  intent: Intent | null;
  state: AgentState | null;
  outcome: RunOutcome | null;
  verifiedResolution: boolean | null;
  primaryFailureCode: FailureCode | null;
  escalated: boolean;
  escalationStatus: 'open' | 'closed' | null;
  durationMs: number | null;
  costUsdMicros: number;
}

export interface ConversationPageDto {
  items: ConversationSummaryDto[];
  nextCursor: string | null;
}

export function toConversationSummaryDto(c: ConversationSummary): ConversationSummaryDto {
  return {
    runId: c.runId,
    conversationId: c.conversationId,
    customer: c.customer,
    startedAt: c.startedAt.toISOString(),
    intent: c.intent,
    state: c.state,
    outcome: c.outcome,
    verifiedResolution: c.verifiedResolution,
    primaryFailureCode: c.primaryFailureCode,
    escalated: c.escalated,
    escalationStatus: c.escalationStatus,
    durationMs: c.durationMs,
    costUsdMicros: c.costUsdMicros,
  };
}

export function toQueuedApprovalDto(a: QueuedApproval): ApprovalDto {
  return {
    id: a.id,
    runId: a.runId,
    conversationId: a.conversationId,
    toolName: a.toolName,
    proposedInput: a.proposedInput,
    reason: a.reason,
    ruleId: a.ruleId,
    policyVersion: a.policyVersion,
    status: a.status,
    requestedAt: a.requestedAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    decidedBy: a.decidedBy,
    decidedByName: a.decidedByName,
    decisionNote: a.decisionNote,
    amountMinor: a.amountMinor,
    currency: a.currency,
  };
}

type Row<K extends keyof AssembledTrace> = AssembledTrace[K];

export function toMessageDto(m: Row<'conversation'>['messages'][number]): MessageDto {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    parts: m.parts,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toConversationDto(c: Row<'conversation'>['row']): ConversationDto {
  return {
    id: c.id,
    state: c.state,
    intent: c.intent,
    outcome: c.outcome,
    channel: c.channel,
    startedAt: c.startedAt.toISOString(),
    lastActivityAt: c.lastActivityAt.toISOString(),
    resolvedAt: iso(c.resolvedAt),
  };
}

export function toTurnDto(r: TurnResult): TurnDto {
  return {
    runId: r.runId,
    traceId: r.traceId,
    conversationId: r.conversationId,
    finalState: r.finalState,
    outcome: r.outcome,
    intent: r.intent,
    text: r.text,
    toolsCalled: r.toolsCalled,
    approvalId: r.approvalId,
    escalationReason: r.escalationReason,
  };
}

/**
 * The money at risk is a policy fact, not a tool argument: `create_replacement`
 * is told which items to send, and the policy engine is the thing that priced it.
 */
function amountAtRisk(
  input: unknown,
  facts: Record<string, unknown> | undefined,
): { amountMinor: number | null; currency: string | null } {
  const sources = [facts, input].filter(
    (v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object',
  );
  for (const source of sources) {
    if (typeof source.amountMinor === 'number') {
      return {
        amountMinor: source.amountMinor,
        currency: typeof source.currency === 'string' ? source.currency : null,
      };
    }
  }
  return { amountMinor: null, currency: null };
}

export function toApprovalDto(
  a: Row<'approvals'>[number],
  policyCheck?: Row<'policyChecks'>[number] | null,
): ApprovalDto {
  return {
    id: a.id,
    runId: a.runId,
    conversationId: a.conversationId,
    toolName: a.toolName,
    proposedInput: a.proposedInput,
    reason: a.reason,
    ruleId: policyCheck?.ruleId ?? null,
    policyVersion: policyCheck?.policyVersion ?? null,
    status: a.status,
    requestedAt: a.requestedAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    decidedBy: a.decidedBy,
    decidedByName: null,
    decisionNote: a.decisionNote,
    ...amountAtRisk(a.proposedInput, policyCheck?.facts),
  };
}

export interface RunStepDto {
  id: string;
  ordinal: number;
  kind: string;
  status: string;
  startedAt: string;
  durationMs: number | null;
  payload: Record<string, unknown>;
}

export interface ToolExecutionDto {
  id: string;
  stepId: string | null;
  toolName: string;
  toolVersion: number;
  input: unknown;
  output: unknown;
  status: string;
  verified: boolean | null;
  verifyObserved: unknown;
  idempotencyKey: string | null;
  attempt: number;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface PolicyCheckDto {
  id: string;
  stepId: string | null;
  policyKey: string;
  policyVersion: string;
  ruleId: string;
  action: string;
  decision: string;
  reason: string;
  facts: Record<string, unknown>;
  missingFacts: string[];
  createdAt: string;
}

export interface RetrievalDto {
  stepId: string;
  query: string;
  chunks: Array<{
    chunkId: string;
    documentId: string;
    documentVersion: number;
    title: string;
    headingPath: string;
    content: string;
    distance: number;
  }>;
}

export interface EvaluationDto {
  verifiedResolution: boolean;
  createdAt: string;
  results: Array<{
    checkId: string;
    verdict: 'MET' | 'UNMET' | 'CANNOT_ASSESS';
    critical: boolean;
    evidence: string;
  }>;
}

interface EvaluationRows {
  verifiedResolution: boolean;
  createdAt: Date;
  results: Array<{
    checkId: string;
    verdict: 'MET' | 'UNMET' | 'CANNOT_ASSESS';
    critical: boolean;
    evidence: string;
  }>;
}

export function toEvaluationDto(row: EvaluationRows | null): EvaluationDto | null {
  if (!row) return null;
  return {
    verifiedResolution: row.verifiedResolution,
    createdAt: row.createdAt.toISOString(),
    results: row.results.map((r) => ({
      checkId: r.checkId,
      verdict: r.verdict,
      critical: r.critical,
      evidence: r.evidence,
    })),
  };
}

export interface TraceDto {
  run: {
    id: string;
    traceId: string;
    conversationId: string;
    agentConfigVersion: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    stepCount: number;
    intent: Intent | null;
    intentConfidence: number | null;
    outcome: RunOutcome | null;
    finalState: AgentState | null;
    errorCode: string | null;
    inProgress: boolean;
  };
  conversation: ConversationDto;
  messages: MessageDto[];
  steps: RunStepDto[];
  toolExecutions: ToolExecutionDto[];
  policyChecks: PolicyCheckDto[];
  approvals: ApprovalDto[];
  escalation: {
    id: string;
    reason: string;
    note: string | null;
    status: string;
    createdAt: string;
    handoff: Record<string, unknown>;
  } | null;
  retrievals: RetrievalDto[];
  totals: { durationMs: number; tokensIn: number; tokensOut: number; costUsdMicros: number };
  evaluation: EvaluationDto | null;
}

export function toTraceDto(trace: AssembledTrace, evaluation: EvaluationDto | null): TraceDto {
  const checkByApproval = new Map(trace.policyChecks.map((c) => [c.id, c]));

  return {
    run: {
      id: trace.run.id,
      traceId: trace.run.traceId,
      conversationId: trace.run.conversationId,
      agentConfigVersion: trace.run.agentConfigVersion,
      startedAt: trace.run.startedAt.toISOString(),
      finishedAt: iso(trace.run.finishedAt),
      durationMs: trace.run.durationMs,
      stepCount: trace.run.stepCount,
      intent: trace.run.intent,
      intentConfidence: trace.run.intentConfidence,
      outcome: trace.run.outcome,
      finalState: trace.run.finalState,
      errorCode: trace.run.errorCode,
      inProgress: trace.run.finishedAt === null,
    },
    conversation: toConversationDto(trace.conversation.row),
    messages: trace.conversation.messages.map(toMessageDto),
    steps: trace.steps.map((s) => ({
      id: s.id,
      ordinal: s.ordinal,
      kind: s.kind,
      status: s.status,
      startedAt: s.startedAt.toISOString(),
      durationMs: s.durationMs,
      payload: s.payload,
    })),
    toolExecutions: trace.toolExecutions.map((e) => ({
      id: e.id,
      stepId: e.stepId,
      toolName: e.toolName,
      toolVersion: e.toolVersion,
      input: e.input,
      output: e.output,
      status: e.status,
      verified: e.verified,
      verifyObserved: e.verifyObserved,
      idempotencyKey: e.idempotencyKey,
      attempt: e.attempt,
      durationMs: e.durationMs,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
      startedAt: e.startedAt.toISOString(),
      finishedAt: iso(e.finishedAt),
    })),
    policyChecks: trace.policyChecks.map((c) => ({
      id: c.id,
      stepId: c.stepId,
      policyKey: c.policyKey,
      policyVersion: c.policyVersion,
      ruleId: c.ruleId,
      action: c.action,
      decision: c.decision,
      reason: c.reason,
      facts: c.facts,
      missingFacts: c.missingFacts,
      createdAt: c.createdAt.toISOString(),
    })),
    approvals: trace.approvals.map((a) =>
      toApprovalDto(a, a.policyCheckId ? checkByApproval.get(a.policyCheckId) : null),
    ),
    escalation: trace.escalation
      ? {
          id: trace.escalation.id,
          reason: trace.escalation.reason,
          note: trace.escalation.note,
          status: trace.escalation.status,
          createdAt: trace.escalation.createdAt.toISOString(),
          handoff: trace.escalation.handoff,
        }
      : null,
    retrievals: trace.retrievals.map((r) => ({
      stepId: r.stepId,
      query: r.query,
      chunks: r.chunks,
    })),
    totals: trace.totals,
    evaluation,
  };
}

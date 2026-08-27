import { now, serverEnv } from '@kora/core';
import { assembleTrace, withTenant } from '@kora/db';
import {
  type ApprovalDto,
  type MetricsDto,
  type TraceDto,
  toApprovalDto,
  toEvaluationDto,
  toTraceDto,
} from '@/lib/api/schemas';

const DEFAULT_WINDOW_DAYS = 30;

export function tenantId(): string {
  return serverEnv().KORA_TENANT_ID;
}

export async function loadMetrics(days = DEFAULT_WINDOW_DAYS): Promise<MetricsDto> {
  const until = now();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  const repos = withTenant(tenantId());
  const runs = await repos.runs.listBetween(since, until);
  const evaluations = await repos.evaluations.forRuns(runs.map((r) => r.id));

  const evaluatedCount = evaluations.length;
  const verified = evaluations.filter((e) => e.verifiedResolution).length;
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return {
    totalRuns: runs.length,
    resolved: runs.filter((r) => r.outcome === 'resolved_automatically').length,
    escalated: runs.filter((r) => r.outcome === 'escalated').length,
    failed: runs.filter((r) => r.outcome === 'failed').length,
    verifiedResolutionRate: evaluatedCount === 0 ? null : verified / evaluatedCount,
    evaluatedCount,
    avgLatencyMs: mean(runs.map((r) => r.durationMs).filter((d): d is number => d !== null)),
    avgCostUsdMicros: mean(runs.map((r) => Number(r.costUsdMicros))),
  };
}

export interface RecentRun {
  runId: string;
  conversationId: string;
  intent: string | null;
  outcome: string | null;
  finalState: string | null;
  startedAt: string;
  durationMs: number | null;
  verifiedResolution: boolean | null;
}

export async function loadRecentRuns(limit = 20): Promise<RecentRun[]> {
  const until = now();
  const since = new Date(until.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const repos = withTenant(tenantId());
  const runs = (await repos.runs.listBetween(since, until)).slice(0, limit);
  const evaluations = await repos.evaluations.forRuns(runs.map((r) => r.id));
  const verifiedByRun = new Map(evaluations.map((e) => [e.runId, e.verifiedResolution]));

  return runs.map((r) => ({
    runId: r.id,
    conversationId: r.conversationId,
    intent: r.intent,
    outcome: r.outcome,
    finalState: r.finalState,
    startedAt: r.startedAt.toISOString(),
    durationMs: r.durationMs,
    verifiedResolution: verifiedByRun.get(r.id) ?? null,
  }));
}

export async function loadPendingApprovals(): Promise<
  Array<ApprovalDto & { customerMessage: string | null }>
> {
  const repos = withTenant(tenantId());
  await repos.approvals.expireOverdue();
  const pending = await repos.approvals.listPending();

  return Promise.all(
    pending.map(async (a) => {
      const [checks, messages] = await Promise.all([
        repos.policyChecks.listForRun(a.runId),
        repos.messages.listForConversation(a.conversationId),
      ]);
      const check = checks.find((c) => c.id === a.policyCheckId) ?? null;
      const firstCustomer = messages.find((m) => m.role === 'customer');
      return { ...toApprovalDto(a, check), customerMessage: firstCustomer?.content ?? null };
    }),
  );
}

export interface ApprovalDetail {
  approval: ApprovalDto;
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  order: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
}

export async function loadApprovalDetail(approvalId: string): Promise<ApprovalDetail | null> {
  const repos = withTenant(tenantId());
  const approval = await repos.approvals.get(approvalId);
  if (!approval) return null;

  const [checks, messages, executions] = await Promise.all([
    repos.policyChecks.listForRun(approval.runId),
    repos.messages.listForConversation(approval.conversationId),
    repos.toolExecutions.listForRun(approval.runId),
  ]);

  const outputOf = (toolName: string) => {
    const row = executions.find((e) => e.toolName === toolName && e.status === 'ok');
    return (row?.output as Record<string, unknown> | undefined) ?? null;
  };

  return {
    approval: toApprovalDto(approval, checks.find((c) => c.id === approval.policyCheckId) ?? null),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    order: outputOf('get_order'),
    customer: outputOf('get_customer'),
  };
}

export async function loadTraceForConversation(
  conversationId: string,
  runId?: string,
): Promise<TraceDto | null> {
  const repos = withTenant(tenantId());
  const conversation = await repos.conversations.get(conversationId);
  if (!conversation) return null;

  const runs = (await repos.runs.listBetween(conversation.startedAt, now())).filter(
    (r) => r.conversationId === conversationId,
  );
  const run = runId ? runs.find((r) => r.id === runId) : runs[0];
  if (!run) return null;

  const [trace, evaluation] = await Promise.all([
    assembleTrace(tenantId(), run.id),
    repos.evaluations.forRun(run.id),
  ]);
  return toTraceDto(trace, toEvaluationDto(evaluation));
}

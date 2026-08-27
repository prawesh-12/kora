import type { Intent } from '@kora/core';
import { now, serverEnv } from '@kora/core';
import {
  type ApprovalQueueFilter,
  type ConversationListFilter,
  assembleTrace,
  computeMetrics,
  failureBreakdown,
  listApprovalQueue,
  listConversationSummaries,
  readApproval,
  vrrTrend,
  withTenant,
} from '@kora/db';
import {
  type ApprovalDto,
  type ConversationPageDto,
  type ConversationSummaryDto,
  type FailureBucketDto,
  type MetricsDto,
  type TraceDto,
  toConversationSummaryDto,
  toEvaluationDto,
  toFailureBucketDto,
  toMetricsDto,
  toQueuedApprovalDto,
  toTraceDto,
} from '@/lib/api/schemas';

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function tenantId(): string {
  return serverEnv().KORA_TENANT_ID;
}

export interface MetricsWindow {
  days?: number;
  from?: Date;
  to?: Date;
  intent?: Intent;
  agentConfigVersion?: string;
}

function windowOf(w: MetricsWindow): { tenantId: string; from: Date; to: Date } {
  const to = w.to ?? now();
  const from = w.from ?? new Date(to.getTime() - (w.days ?? DEFAULT_WINDOW_DAYS) * DAY_MS);
  return { tenantId: tenantId(), from, to };
}

export async function loadMetrics(w: MetricsWindow = {}): Promise<MetricsDto> {
  const filter = {
    ...windowOf(w),
    ...(w.intent ? { intent: w.intent } : {}),
    ...(w.agentConfigVersion ? { agentConfigVersion: w.agentConfigVersion } : {}),
  };
  const [metrics, trend] = await Promise.all([computeMetrics(filter), vrrTrend(filter)]);
  return toMetricsDto(metrics, trend);
}

export async function loadFailureBreakdown(w: MetricsWindow = {}): Promise<FailureBucketDto[]> {
  const filter = {
    ...windowOf(w),
    ...(w.intent ? { intent: w.intent } : {}),
    ...(w.agentConfigVersion ? { agentConfigVersion: w.agentConfigVersion } : {}),
  };
  return (await failureBreakdown(filter)).map(toFailureBucketDto);
}

export type ConversationFilters = Omit<ConversationListFilter, 'tenantId' | 'limit' | 'cursor'>;

export async function loadConversations(
  filters: ConversationFilters,
  limit = 50,
): Promise<ConversationPageDto> {
  const page = await listConversationSummaries({ tenantId: tenantId(), limit, ...filters });
  return { items: page.items.map(toConversationSummaryDto), nextCursor: page.nextCursor };
}

export async function loadRecentRuns(limit = 20): Promise<ConversationSummaryDto[]> {
  const page = await loadConversations({}, limit);
  return page.items;
}

export async function loadApprovalQueue(
  filter: ApprovalQueueFilter = {},
): Promise<Array<ApprovalDto & { customerMessage: string | null }>> {
  const repos = withTenant(tenantId());
  const approvals = await listApprovalQueue(tenantId(), filter);

  return Promise.all(
    approvals.map(async (a) => {
      const messages = await repos.messages.listForConversation(a.conversationId);
      const firstCustomer = messages.find((m) => m.role === 'customer');
      return { ...toQueuedApprovalDto(a), customerMessage: firstCustomer?.content ?? null };
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
  const approval = await readApproval(tenantId(), approvalId);
  if (!approval) return null;

  const [messages, executions] = await Promise.all([
    repos.messages.listForConversation(approval.conversationId),
    repos.toolExecutions.listForRun(approval.runId),
  ]);

  const outputOf = (toolName: string) => {
    const row = executions.find((e) => e.toolName === toolName && e.status === 'ok');
    return (row?.output as Record<string, unknown> | undefined) ?? null;
  };

  return {
    approval: toQueuedApprovalDto(approval),
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

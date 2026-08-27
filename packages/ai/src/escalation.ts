import type { EscalationReason, Intent, PolicyDecision } from '@kora/core';
import { now } from '@kora/core';
import { type RunHandle, withTenant } from '@kora/db';
import type { GatheredContext } from '@kora/tools';
import type { RetrievedChunk } from './knowledge/search.js';

export interface HandoffPayload {
  customer: { id: string; name: string; email: string } | null;
  conversation: Array<{ role: string; content: string; at: string }>;
  intent: { value: Intent; confidence: number; evidence: string } | null;
  retrievedPolicy: Array<{
    title: string;
    headingPath: string;
    excerpt: string;
    documentVersion: number;
  }>;
  actionsExecuted: Array<{
    tool: string;
    input: unknown;
    output: unknown;
    verified: boolean | null;
    at: string;
  }>;
  actionsBlocked: Array<{
    tool: string;
    input: unknown;
    decision: PolicyDecision;
    ruleId: string;
    reason: string;
  }>;
  escalation: { reason: EscalationReason; note?: string };
  traceId: string;
}

/**
 * The handoff is built now, not lazily on read. If a policy or a document changes
 * before a human opens it, the handoff must still show what the agent actually saw.
 *
 * Escalating twice in one run is a no-op: a retry storm must not open five cases.
 */
export async function escalate(args: {
  run: RunHandle;
  reason: EscalationReason;
  note?: string;
  gathered: GatheredContext;
  intent: { value: Intent; confidence: number; evidence: string } | null;
  chunks: RetrievedChunk[];
}): Promise<{ escalationId: string; handoff: HandoffPayload; alreadyOpen: boolean }> {
  const repos = withTenant(args.run.tenantId);

  const existing = await repos.escalations.forRun(args.run.runId);
  if (existing) {
    return {
      escalationId: existing.id,
      handoff: existing.handoff as unknown as HandoffPayload,
      alreadyOpen: true,
    };
  }

  const [messages, executions, checks] = await Promise.all([
    repos.messages.listForConversation(args.run.conversationId),
    repos.toolExecutions.listForRun(args.run.runId),
    repos.policyChecks.listForRun(args.run.runId),
  ]);

  const handoff: HandoffPayload = {
    customer: args.gathered.customer ?? null,
    conversation: messages.map((m) => ({
      role: m.role,
      content: m.content,
      at: m.createdAt.toISOString(),
    })),
    intent: args.intent,
    retrievedPolicy: args.chunks.map((c) => ({
      title: c.title,
      headingPath: c.headingPath,
      excerpt: c.content.slice(0, 400),
      documentVersion: c.documentVersion,
    })),
    actionsExecuted: executions
      .filter((e) => e.status === 'ok' || e.status === 'replayed')
      .map((e) => ({
        tool: e.toolName,
        input: e.input,
        output: e.output,
        verified: e.verified,
        at: e.startedAt.toISOString(),
      })),
    actionsBlocked: checks
      .filter((c) => c.decision !== 'allow')
      .map((c) => ({
        tool: c.action,
        input: c.facts,
        decision: c.decision,
        ruleId: c.ruleId,
        reason: c.reason,
      })),
    escalation: { reason: args.reason, ...(args.note ? { note: args.note } : {}) },
    traceId: args.run.traceId,
  };

  const row = await repos.escalations.create({
    conversationId: args.run.conversationId,
    runId: args.run.runId,
    reason: args.reason,
    handoff: handoff as unknown as Record<string, unknown>,
    note: args.note ?? null,
    status: 'open',
    createdAt: now(),
  });

  return { escalationId: row.id, handoff, alreadyOpen: false };
}

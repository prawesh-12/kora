import { runAgentTurn } from '@kora/ai';
import { isTerminalState, now, serverEnv } from '@kora/core';
import { decideApproval, withTenant } from '@kora/db';
import { after } from 'next/server';
import { requireOperator } from '@/lib/api/auth';
import { conflict, gone, handle, notFound } from '@/lib/api/errors';
import {
  ApprovalDecisionRequest,
  parseBody,
  toQueuedApprovalDto,
  toTurnDto,
} from '@/lib/api/schemas';

export const maxDuration = 60;

const DENIED_REPLY =
  'A colleague has reviewed this and we are not able to complete it automatically. ' +
  'Someone will be in touch with you shortly.';

function orderIdOf(proposedInput: unknown): string | null {
  if (!proposedInput || typeof proposedInput !== 'object') return null;
  const value = (proposedInput as Record<string, unknown>).orderId;
  return typeof value === 'string' ? value : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const operator = await requireOperator();
    const { id } = await params;
    const { decision, note } = await parseBody(req, ApprovalDecisionRequest);

    const tenantId = serverEnv().KORA_TENANT_ID;

    // Reads and decides through the query layer, which expires an overdue approval
    // before it looks at it. A stale pending row can never be decided.
    const outcome = await decideApproval(tenantId, id, {
      status: decision,
      decidedBy: operator.id,
      ...(note ? { decisionNote: note } : {}),
    });

    if (outcome.kind === 'missing') throw notFound('approval');
    if (outcome.kind === 'expired') {
      throw gone('this approval expired before it was decided, and the run was handed to a person');
    }
    if (outcome.kind === 'conflict') {
      const who = outcome.approval.decidedByName ?? outcome.approval.decidedBy ?? 'someone else';
      throw conflict(`this approval was already ${outcome.approval.status} by ${who}`);
    }

    const decided = outcome.approval;

    if (decision === 'denied') {
      await denyAndHandOff(tenantId, decided.runId, decided.conversationId, note ?? null);
      return Response.json({ approval: toQueuedApprovalDto(decided), turn: null });
    }

    const orderId = orderIdOf(decided.proposedInput);
    const resumeMessage = orderId
      ? `Please go ahead with the replacement for the damaged item on order ${orderId}.`
      : 'Please go ahead with the action a colleague has just approved.';

    // A human has signed off, so this turn runs with the approval gate lifted. The
    // pipeline recognises the approved row for the conversation. See docs/decisions.md.
    //
    // Recorded as `human_agent`, because it is an operator acting. Recording it as
    // the customer put words in their mouth and showed their own message twice.
    const turn = await runAgentTurn({
      tenantId,
      conversationId: decided.conversationId,
      message: resumeMessage,
      role: 'human_agent',
    });

    if (isTerminalState(turn.finalState)) {
      after(async () => {
        const { evaluateRun } = await import('@kora/evaluation');
        await evaluateRun({ tenantId, runId: turn.runId }).catch(() => {});
      });
    }

    return Response.json({ approval: toQueuedApprovalDto(decided), turn: toTurnDto(turn) });
  });
}

async function denyAndHandOff(
  tenantId: string,
  runId: string,
  conversationId: string,
  note: string | null,
): Promise<void> {
  const repos = withTenant(tenantId);
  const run = await repos.runs.get(runId);
  if (!run) return;

  const [messages, checks] = await Promise.all([
    repos.messages.listForConversation(conversationId),
    repos.policyChecks.listForRun(runId),
  ]);

  const existing = await repos.escalations.forRun(runId);
  if (!existing) {
    await repos.escalations.create({
      conversationId,
      runId,
      reason: 'APPROVAL_DENIED',
      handoff: {
        customer: null,
        conversation: messages.map((m) => ({
          role: m.role,
          content: m.content,
          at: m.createdAt.toISOString(),
        })),
        intent: run.intent
          ? { value: run.intent, confidence: run.intentConfidence ?? 0, evidence: '' }
          : null,
        retrievedPolicy: [],
        actionsExecuted: [],
        actionsBlocked: checks
          .filter((c) => c.decision !== 'allow')
          .map((c) => ({
            tool: c.action,
            input: c.facts,
            decision: c.decision,
            ruleId: c.ruleId,
            reason: c.reason,
          })),
        escalation: { reason: 'APPROVAL_DENIED', ...(note ? { note } : {}) },
        traceId: run.traceId,
      },
      note,
      status: 'open',
      createdAt: now(),
    });
  }

  await repos.messages.create({
    conversationId,
    role: 'agent',
    content: DENIED_REPLY,
    parts: [{ type: 'text', text: DENIED_REPLY }],
    createdAt: now(),
  });

  await repos.runs.patch(runId, {
    finalState: 'NEEDS_HUMAN',
    outcome: 'escalated',
    errorCode: 'APPROVAL_DENIED',
  });
  await repos.conversations.patch(conversationId, { state: 'NEEDS_HUMAN', outcome: 'escalated' });
}

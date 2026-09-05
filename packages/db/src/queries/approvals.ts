import { newId, now } from '@kora/core';
import { type SQL, and, eq, lte, sql } from 'drizzle-orm';
import { type Database, type Tx, db } from '../client.js';
import * as s from '../schema/index.js';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface QueuedApproval {
  id: string;
  runId: string;
  conversationId: string;
  toolName: string;
  proposedInput: unknown;
  reason: string;
  policyCheckId: string | null;
  ruleId: string | null;
  policyVersion: string | null;
  status: ApprovalStatus;
  requestedAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  amountMinor: number | null;
  currency: string | null;
}

export interface ApprovalQueueFilter {
  status?: 'pending' | 'decided' | 'expired' | 'all' | undefined;
  decidedSince?: Date | undefined;
  toolName?: string | undefined;
  minValueMinor?: number | undefined;
  maxValueMinor?: number | undefined;
  limit?: number | undefined;
}

export interface ExpiredApproval {
  id: string;
  runId: string;
  conversationId: string;
  toolName: string;
}

export type DecisionOutcome =
  | { kind: 'decided'; approval: QueuedApproval }
  | { kind: 'expired'; approval: QueuedApproval }
  | { kind: 'conflict'; approval: QueuedApproval }
  | { kind: 'missing' };

const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;

const EXPIRY_REPLY =
  'Nobody was able to review this in time, so we have not made the change automatically. ' +
  'A member of our team will follow up with you directly.';

const EXPIRY_NOTE = 'the approval window closed before anyone decided';

interface ApprovalRow {
  id: string;
  run_id: string;
  conversation_id: string;
  tool_name: string;
  proposed_input: unknown;
  reason: string;
  policy_check_id: string | null;
  rule_id: string | null;
  policy_version: string | null;
  status: ApprovalStatus;
  requested_at: Date;
  expires_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  amount_minor: string | number | null;
  currency: string | null;
}

function toQueued(r: ApprovalRow): QueuedApproval {
  return {
    id: r.id,
    runId: r.run_id,
    conversationId: r.conversation_id,
    toolName: r.tool_name,
    proposedInput: r.proposed_input,
    reason: r.reason,
    policyCheckId: r.policy_check_id,
    ruleId: r.rule_id,
    policyVersion: r.policy_version,
    status: r.status,
    requestedAt: new Date(r.requested_at),
    expiresAt: new Date(r.expires_at),
    decidedAt: r.decided_at === null ? null : new Date(r.decided_at),
    decidedBy: r.decided_by,
    decidedByName: r.decided_by_name,
    decisionNote: r.decision_note,
    amountMinor: r.amount_minor === null ? null : Number(r.amount_minor),
    currency: r.currency,
  };
}

/**
 * The money at risk is a policy fact first and a tool argument second: the policy
 * engine priced the action, and `create_replacement` is only told which items to
 * send. Both are read as jsonb, so the type is checked before the cast.
 */
function enrichedSql(tenantId: string, where: SQL): SQL {
  return sql`
    select
      a.id, a.run_id, a.conversation_id, a.tool_name, a.proposed_input, a.reason,
      a.policy_check_id, a.status, a.requested_at, a.expires_at,
      a.decided_at, a.decided_by, a.decision_note,
      pc.rule_id, pc.policy_version,
      u.name as decided_by_name,
      coalesce(
        case when jsonb_typeof(pc.facts -> 'amountMinor') = 'number'
          then (pc.facts ->> 'amountMinor')::bigint end,
        case when jsonb_typeof(a.proposed_input -> 'amountMinor') = 'number'
          then (a.proposed_input ->> 'amountMinor')::bigint end
      ) as amount_minor,
      coalesce(pc.facts ->> 'currency', a.proposed_input ->> 'currency') as currency
    from approvals a
    left join policy_checks pc on pc.id = a.policy_check_id
    left join "user" u on u.id = a.decided_by
    where a.tenant_id = ${tenantId} and ${where}
  `;
}

export function approvalQueueSql(tenantId: string, f: ApprovalQueueFilter): SQL {
  const inner: SQL[] = [];
  switch (f.status ?? 'pending') {
    case 'pending':
      inner.push(sql`a.status = 'pending'`);
      break;
    case 'decided':
      inner.push(sql`a.status in ('approved', 'denied')`);
      break;
    case 'expired':
      inner.push(sql`a.status = 'expired'`);
      break;
    case 'all':
      inner.push(sql`true`);
      break;
  }
  if (f.decidedSince) inner.push(sql`a.decided_at >= ${ts(f.decidedSince)}`);
  if (f.toolName) inner.push(sql`a.tool_name = ${f.toolName}`);

  const outer: SQL[] = [sql`true`];
  if (f.minValueMinor !== undefined) {
    outer.push(sql`coalesce(amount_minor, 0) >= ${f.minValueMinor}`);
  }
  if (f.maxValueMinor !== undefined) {
    outer.push(sql`coalesce(amount_minor, 0) < ${f.maxValueMinor}`);
  }

  // Money at risk descending, because the expensive decision is the one that should
  // be looked at first. Ties fall back to the longest wait.
  return sql`
    with enriched as (${enrichedSql(tenantId, sql.join(inner, sql` and `))})
    select * from enriched
    where ${sql.join(outer, sql` and `)}
    order by amount_minor desc nulls last, requested_at asc
    limit ${f.limit ?? 200}
  `;
}

async function selectOne(tenantId: string, id: string): Promise<QueuedApproval | null> {
  const rows = (await db().execute(
    enrichedSql(tenantId, sql`a.id = ${id}`),
  )) as unknown as ApprovalRow[];
  const row = rows[0];
  return row ? toQueued(row) : null;
}

/**
 * Called on every read and every decision, so a stale pending row can never reach the
 * queue. The CLI sweep runs this same function, so the two cannot disagree.
 */
export async function expireOverdueApprovals(
  tenantId: string,
  opts: { id?: string | undefined } = {},
): Promise<ExpiredApproval[]> {
  const at = now();
  const conn: Database = db();

  const overdue = await conn
    .update(s.approvals)
    .set({ status: 'expired', decisionNote: EXPIRY_NOTE })
    .where(
      and(
        eq(s.approvals.tenantId, tenantId),
        eq(s.approvals.status, 'pending'),
        lte(s.approvals.expiresAt, at),
        ...(opts.id ? [eq(s.approvals.id, opts.id)] : []),
      ),
    )
    .returning({
      id: s.approvals.id,
      runId: s.approvals.runId,
      conversationId: s.approvals.conversationId,
      toolName: s.approvals.toolName,
      proposedInput: s.approvals.proposedInput,
    });

  for (const approval of overdue) {
    await conn.transaction((tx) => handOff(tx, tenantId, approval, at));
  }

  return overdue.map(({ id, runId, conversationId, toolName }) => ({
    id,
    runId,
    conversationId,
    toolName,
  }));
}

async function handOff(
  tx: Tx,
  tenantId: string,
  approval: {
    id: string;
    runId: string;
    conversationId: string;
    toolName: string;
    proposedInput: unknown;
  },
  at: Date,
): Promise<void> {
  const [run] = await tx
    .select()
    .from(s.agentRuns)
    .where(and(eq(s.agentRuns.id, approval.runId), eq(s.agentRuns.tenantId, tenantId)));
  if (!run) return;

  const [existing] = await tx
    .select({ id: s.escalations.id })
    .from(s.escalations)
    .where(and(eq(s.escalations.runId, approval.runId), eq(s.escalations.tenantId, tenantId)));

  if (!existing) {
    const transcript = await tx
      .select({
        role: s.messages.role,
        content: s.messages.content,
        createdAt: s.messages.createdAt,
      })
      .from(s.messages)
      .where(eq(s.messages.conversationId, approval.conversationId))
      .orderBy(s.messages.createdAt);

    await tx.insert(s.escalations).values({
      id: newId('esc'),
      tenantId,
      conversationId: approval.conversationId,
      runId: approval.runId,
      reason: 'APPROVAL_DENIED',
      note: EXPIRY_NOTE,
      status: 'open',
      createdAt: at,
      handoff: {
        escalation: { reason: 'APPROVAL_DENIED', note: EXPIRY_NOTE },
        approval: {
          id: approval.id,
          tool: approval.toolName,
          proposedInput: approval.proposedInput,
        },
        conversation: transcript.map((m) => ({
          role: m.role,
          content: m.content,
          at: m.createdAt.toISOString(),
        })),
        traceId: run.traceId,
      },
    });
  }

  await tx.insert(s.messages).values({
    id: newId('msg'),
    tenantId,
    conversationId: approval.conversationId,
    role: 'agent',
    content: EXPIRY_REPLY,
    parts: [{ type: 'text', text: EXPIRY_REPLY }],
    createdAt: at,
  });

  await tx
    .update(s.agentRuns)
    .set({ finalState: 'NEEDS_HUMAN', outcome: 'escalated', errorCode: 'APPROVAL_DENIED' })
    .where(eq(s.agentRuns.id, approval.runId));

  await tx
    .update(s.conversations)
    .set({ state: 'NEEDS_HUMAN', outcome: 'escalated', lastActivityAt: at })
    .where(eq(s.conversations.id, approval.conversationId));
}

export async function readApproval(tenantId: string, id: string): Promise<QueuedApproval | null> {
  await expireOverdueApprovals(tenantId, { id });
  return selectOne(tenantId, id);
}

export async function listApprovalQueue(
  tenantId: string,
  filter: ApprovalQueueFilter = {},
): Promise<QueuedApproval[]> {
  await expireOverdueApprovals(tenantId);
  const rows = (await db().execute(approvalQueueSql(tenantId, filter))) as unknown as ApprovalRow[];
  return rows.map(toQueued);
}

export async function decideApproval(
  tenantId: string,
  id: string,
  patch: { status: 'approved' | 'denied'; decidedBy: string; decisionNote?: string | undefined },
): Promise<DecisionOutcome> {
  await expireOverdueApprovals(tenantId, { id });

  // The conditional update is the lock: a second concurrent decision matches no row.
  const [updated] = await db()
    .update(s.approvals)
    .set({
      status: patch.status,
      decidedBy: patch.decidedBy,
      decidedAt: now(),
      ...(patch.decisionNote ? { decisionNote: patch.decisionNote } : {}),
    })
    .where(
      and(
        eq(s.approvals.id, id),
        eq(s.approvals.tenantId, tenantId),
        eq(s.approvals.status, 'pending'),
      ),
    )
    .returning({ id: s.approvals.id });

  const current = await selectOne(tenantId, id);
  if (!current) return { kind: 'missing' };
  if (updated) return { kind: 'decided', approval: current };
  return current.status === 'expired'
    ? { kind: 'expired', approval: current }
    : { kind: 'conflict', approval: current };
}

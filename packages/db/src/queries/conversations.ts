import type { AgentState, FailureCode, Intent, RunOutcome } from '@kora/core';
import { type SQL, sql } from 'drizzle-orm';
import { db } from '../client.js';

export interface ConversationListFilter {
  tenantId: string;
  limit: number;
  from?: Date | undefined;
  to?: Date | undefined;
  intent?: Intent | undefined;
  outcome?: RunOutcome | undefined;
  failureCode?: FailureCode | undefined;
  verified?: boolean | undefined;
  escalated?: boolean | undefined;
  escalationStatus?: 'open' | 'closed' | undefined;
  cursor?: ConversationCursor | undefined;
}

export interface ConversationCursor {
  startedAt: Date;
  id: string;
}

export interface ConversationSummaryRow {
  run_id: string;
  conversation_id: string;
  external_customer_id: string | null;
  started_at: Date;
  intent: Intent | null;
  state: AgentState | null;
  outcome: RunOutcome | null;
  verified_resolution: boolean | null;
  primary_failure_code: FailureCode | null;
  escalated: boolean;
  escalation_status: 'open' | 'closed' | null;
  duration_ms: number | null;
  cost_usd_micros: string | number;
}

export function encodeCursor(c: ConversationCursor): string {
  return Buffer.from(`${c.startedAt.toISOString()}|${c.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): ConversationCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.indexOf('|');
  if (separator < 1) return null;

  const startedAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(startedAt.getTime()) || id.length === 0) return null;
  return { startedAt, id };
}

/**
 * Keyset pagination on `(started_at, id)`: offset pagination would slow down with
 * every week of traffic, and an insert mid-paging would shift every later page.
 */
const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;

export function conversationPageSql(f: ConversationListFilter): SQL {
  const parts: SQL[] = [sql`r.tenant_id = ${f.tenantId}`];
  if (f.from) parts.push(sql`r.started_at >= ${ts(f.from)}`);
  if (f.to) parts.push(sql`r.started_at <= ${ts(f.to)}`);
  if (f.intent) parts.push(sql`r.intent = ${f.intent}`);
  if (f.outcome) parts.push(sql`r.outcome = ${f.outcome}`);
  if (f.failureCode) parts.push(sql`e.failure_codes[1] = ${f.failureCode}`);
  if (f.verified !== undefined) parts.push(sql`e.verified_resolution = ${f.verified}`);
  if (f.escalated !== undefined) {
    parts.push(f.escalated ? sql`esc.id is not null` : sql`esc.id is null`);
  }
  if (f.escalationStatus) parts.push(sql`esc.status = ${f.escalationStatus}`);
  if (f.cursor) {
    parts.push(sql`(r.started_at, r.id) < (${ts(f.cursor.startedAt)}, ${f.cursor.id})`);
  }

  return sql`
    select
      r.id as run_id,
      r.conversation_id,
      c.external_customer_id,
      r.started_at,
      r.intent,
      r.final_state as state,
      r.outcome,
      e.verified_resolution,
      e.failure_codes[1] as primary_failure_code,
      (esc.id is not null) as escalated,
      esc.status as escalation_status,
      r.duration_ms,
      r.cost_usd_micros
    from agent_runs r
    join conversations c on c.id = r.conversation_id
    left join evaluations e on e.run_id = r.id
    left join lateral (
      select s.id, s.status
      from escalations s
      where s.run_id = r.id
      order by s.created_at asc
      limit 1
    ) esc on true
    where ${sql.join(parts, sql` and `)}
    order by r.started_at desc, r.id desc
    limit ${f.limit}
  `;
}

export interface ConversationSummary {
  runId: string;
  conversationId: string;
  customer: string | null;
  startedAt: Date;
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

export interface ConversationPage {
  items: ConversationSummary[];
  nextCursor: string | null;
}

export async function listConversationSummaries(
  f: ConversationListFilter,
): Promise<ConversationPage> {
  const query = conversationPageSql({ ...f, limit: f.limit + 1 });
  const raw = (await db().execute(query)) as unknown as ConversationSummaryRow[];

  const page = raw.slice(0, f.limit);
  const last = page.at(-1);
  const nextCursor =
    raw.length > f.limit && last
      ? encodeCursor({ startedAt: new Date(last.started_at), id: last.run_id })
      : null;

  return {
    items: page.map((r) => ({
      runId: r.run_id,
      conversationId: r.conversation_id,
      customer: r.external_customer_id,
      startedAt: new Date(r.started_at),
      intent: r.intent,
      state: r.state,
      outcome: r.outcome,
      verifiedResolution: r.verified_resolution,
      primaryFailureCode: r.primary_failure_code,
      escalated: r.escalated === true,
      escalationStatus: r.escalation_status,
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      costUsdMicros: Number(r.cost_usd_micros ?? 0),
    })),
    nextCursor,
  };
}

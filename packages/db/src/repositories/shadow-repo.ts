import { newId, now } from '@kora/core';
import { and, desc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { agentRuns } from '../schema/runs.js';
import { shadowComparisons } from '../schema/shadow.js';

const sqlCount = sql<string>`count(*)`;

export type Agreement = 'match' | 'action_differs' | 'amount_differs' | 'no_human_record';

export interface ShadowProposal {
  tenantId: string;
  conversationId: string;
  runId: string;
  proposedAction: string | null;
  proposedAmountMinor: number | null;
}

export interface HumanResolution {
  action: string | null;
  amountMinor: number | null;
}

/**
 * A missing human resolution is its own verdict, never counted as agreement.
 * Treating "we do not know" as "we agreed" is how a shadow report reads 95% while
 * measuring nothing.
 */
export function agreementOf(
  proposal: ShadowProposal,
  actual: HumanResolution | null,
): { agreement: Agreement; valueAtRiskMinor: number } {
  if (!actual || (actual.action === null && actual.amountMinor === null)) {
    return { agreement: 'no_human_record', valueAtRiskMinor: 0 };
  }

  if (proposal.proposedAction !== actual.action) {
    return {
      agreement: 'action_differs',
      valueAtRiskMinor: Math.max(proposal.proposedAmountMinor ?? 0, actual.amountMinor ?? 0),
    };
  }

  const proposed = proposal.proposedAmountMinor ?? 0;
  const real = actual.amountMinor ?? 0;
  if (proposed !== real) {
    return { agreement: 'amount_differs', valueAtRiskMinor: Math.abs(proposed - real) };
  }

  return { agreement: 'match', valueAtRiskMinor: 0 };
}

export async function recordShadowComparison(
  proposal: ShadowProposal,
  actual: HumanResolution | null,
): Promise<void> {
  const { agreement, valueAtRiskMinor } = agreementOf(proposal, actual);

  await db()
    .insert(shadowComparisons)
    .values({
      id: newId('ev'),
      tenantId: proposal.tenantId,
      conversationId: proposal.conversationId,
      runId: proposal.runId,
      proposedAction: proposal.proposedAction,
      proposedAmountMinor: proposal.proposedAmountMinor,
      actualAction: actual?.action ?? null,
      actualAmountMinor: actual?.amountMinor ?? null,
      agreement,
      valueAtRiskMinor,
      createdAt: now(),
    });
}

export async function compareShadowDay(
  tenantId: string,
  date: Date,
): Promise<Array<{ intent: string; n: number; agreementRate: number }>> {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);

  const rows = await db()
    .select({ intent: agentRuns.intent, agreement: shadowComparisons.agreement })
    .from(shadowComparisons)
    .innerJoin(agentRuns, eq(agentRuns.id, shadowComparisons.runId))
    .where(
      and(
        eq(shadowComparisons.tenantId, tenantId),
        gte(shadowComparisons.createdAt, start),
        lt(shadowComparisons.createdAt, end),
      ),
    );

  const byIntent = new Map<string, { n: number; matched: number }>();
  for (const row of rows) {
    if (row.agreement === 'no_human_record') continue;
    const key = row.intent ?? 'unknown';
    const entry = byIntent.get(key) ?? { n: 0, matched: 0 };
    entry.n++;
    if (row.agreement === 'match') entry.matched++;
    byIntent.set(key, entry);
  }

  return [...byIntent]
    .map(([intent, { n, matched }]) => ({ intent, n, agreementRate: matched / n }))
    .sort((a, b) => a.intent.localeCompare(b.intent));
}

/**
 * A run nobody handled is not a disagreement, so `no_human_record` is excluded here
 * rather than at render; `skippedCount` reports those separately.
 */
export async function disagreementsByValue(tenantId: string, limit = 50) {
  return db()
    .select()
    .from(shadowComparisons)
    .where(
      and(
        eq(shadowComparisons.tenantId, tenantId),
        notInArray(shadowComparisons.agreement, ['match', 'no_human_record']),
      ),
    )
    .orderBy(desc(shadowComparisons.valueAtRiskMinor))
    .limit(limit);
}

/** How many runs had no human resolution to compare against. */
export async function skippedCount(tenantId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sqlCount })
    .from(shadowComparisons)
    .where(
      and(
        eq(shadowComparisons.tenantId, tenantId),
        eq(shadowComparisons.agreement, 'no_human_record'),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function matchedCount(tenantId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sqlCount })
    .from(shadowComparisons)
    .where(and(eq(shadowComparisons.tenantId, tenantId), eq(shadowComparisons.agreement, 'match')));
  return Number(row?.n ?? 0);
}

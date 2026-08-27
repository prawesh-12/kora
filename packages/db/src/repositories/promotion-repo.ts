import { newId, now } from '@kora/core';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client.js';
import { agentVersions } from '../schema/agents.js';
import { promotions } from '../schema/promotions.js';
import { activate, loadActive, previousActive } from './agent-repo.js';

export interface PromotionEvidence {
  benchmarkPassed: boolean;
  benchmarkRunId?: string;
  benchmarkFailedGates?: string[];
  replayRunId?: string;
  replayCompared?: number;
  replayVrrDelta?: number;
  regressions?: string[];
}

export interface Blocked {
  gate: string;
  reason: string;
}

const MIN_REPLAY_CONVERSATIONS = 500;

/**
 * The gates, checked before anyone can promote.
 *
 * Each exists because shipping past it has a specific cost: a failing benchmark
 * ships a known regression, a thin replay ships an unmeasured one, and an
 * unreviewed regression ships one nobody has looked at.
 */
export function promotionGates(
  evidence: PromotionEvidence,
  acceptedRegressions: string[],
): Blocked[] {
  const blocked: Blocked[] = [];

  if (!evidence.benchmarkPassed) {
    blocked.push({
      gate: 'benchmark',
      reason: evidence.benchmarkFailedGates?.length
        ? `the benchmark failed: ${evidence.benchmarkFailedGates.join('; ')}`
        : 'no passing benchmark run is recorded for this version',
    });
  }

  if (!evidence.replayRunId) {
    blocked.push({ gate: 'replay', reason: 'no replay has been run against this version' });
  } else if ((evidence.replayCompared ?? 0) < MIN_REPLAY_CONVERSATIONS) {
    blocked.push({
      gate: 'replay',
      reason: `replay compared ${evidence.replayCompared ?? 0} conversations, and ${MIN_REPLAY_CONVERSATIONS} are needed to see a real regression`,
    });
  } else if ((evidence.replayVrrDelta ?? 0) < 0) {
    blocked.push({
      gate: 'replay',
      reason: `verified resolution regressed by ${Math.abs((evidence.replayVrrDelta ?? 0) * 100).toFixed(1)} points`,
    });
  }

  const unreviewed = (evidence.regressions ?? []).filter((r) => !acceptedRegressions.includes(r));
  if (unreviewed.length > 0) {
    blocked.push({
      gate: 'regressions',
      reason: `${unreviewed.length} regression(s) have not been reviewed: ${unreviewed.slice(0, 5).join(', ')}`,
    });
  }

  return blocked;
}

export async function requestPromotion(args: {
  tenantId: string;
  versionId: string;
  evidence: PromotionEvidence;
  acceptedRegressions?: string[];
}): Promise<{ blocked: Blocked[] }> {
  return { blocked: promotionGates(args.evidence, args.acceptedRegressions ?? []) };
}

export async function promote(args: {
  tenantId: string;
  versionId: string;
  actorId: string;
  evidence: PromotionEvidence;
  acceptedRegressions?: string[];
  note?: string;
}): Promise<{ blocked: Blocked[]; promoted: boolean }> {
  const accepted = args.acceptedRegressions ?? [];
  const blocked = promotionGates(args.evidence, accepted);
  if (blocked.length > 0) return { blocked, promoted: false };

  const from = await loadActive(args.tenantId).catch(() => null);
  await activate(args.tenantId, args.versionId, args.actorId);

  await db()
    .insert(promotions)
    .values({
      id: newId('ev'),
      tenantId: args.tenantId,
      versionId: args.versionId,
      fromVersionId: from?.id ?? null,
      kind: 'promote',
      benchmarkRunId: args.evidence.benchmarkRunId ?? null,
      replayRunId: args.evidence.replayRunId ?? null,
      acceptedRegressions: accepted,
      note: args.note ?? null,
      actorId: args.actorId,
      createdAt: now(),
    });

  return { blocked: [], promoted: true };
}

/**
 * Always available, no gates, no redeploy. In-flight runs finish on the version
 * they started with, which pinning at run start already guarantees.
 */
export async function rollback(
  tenantId: string,
  actorId: string,
  note?: string,
): Promise<{ restoredVersionId: string } | null> {
  const from = await loadActive(tenantId).catch(() => null);
  const previous = await previousActive(tenantId);
  if (!previous) return null;

  // A version whose policy bundle no longer exists cannot be restored. Policy
  // versions are never deleted, so this should be impossible; the check is here
  // because "should be impossible" is not a guarantee.
  const missing = await missingPolicyVersions(tenantId, previous.policyBundle);
  if (missing.length > 0) {
    throw new Error(
      `cannot roll back to version ${previous.version}: policy version(s) ${missing.join(', ')} no longer exist`,
    );
  }

  await activate(tenantId, previous.id, actorId);

  await db()
    .insert(promotions)
    .values({
      id: newId('ev'),
      tenantId,
      versionId: previous.id,
      fromVersionId: from?.id ?? null,
      kind: 'rollback',
      acceptedRegressions: [],
      note: note ?? null,
      actorId,
      createdAt: now(),
    });

  return { restoredVersionId: previous.id };
}

async function missingPolicyVersions(tenantId: string, versionIds: string[]): Promise<string[]> {
  if (versionIds.length === 0) return [];
  const { policyVersions } = await import('../schema/policies.js');
  const { inArray } = await import('drizzle-orm');
  const rows = await db()
    .select({ id: policyVersions.id })
    .from(policyVersions)
    .where(and(eq(policyVersions.tenantId, tenantId), inArray(policyVersions.id, versionIds)));
  const present = new Set(rows.map((r) => r.id));
  return versionIds.filter((id) => !present.has(id));
}

export async function promotionHistory(tenantId: string, limit = 50) {
  return db()
    .select({
      id: promotions.id,
      kind: promotions.kind,
      versionId: promotions.versionId,
      fromVersionId: promotions.fromVersionId,
      version: agentVersions.version,
      acceptedRegressions: promotions.acceptedRegressions,
      note: promotions.note,
      createdAt: promotions.createdAt,
    })
    .from(promotions)
    .innerJoin(agentVersions, eq(agentVersions.id, promotions.versionId))
    .where(eq(promotions.tenantId, tenantId))
    .orderBy(desc(promotions.createdAt))
    .limit(limit);
}

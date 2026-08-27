import { logger, newId } from '@kora/core';
import { assembleTrace, withTenant } from '@kora/db';
import { evaluateRun } from '../evaluate.js';
import type { ScenarioDeps } from '../scenarios/runner.js';
import type { ExternalStateSnapshot } from '../types.js';
import {
  type NotReplayable,
  type ReplayCandidate,
  type ReplayOutcome,
  type ReplayReport,
  buildReport,
  loadCandidates,
  stratify,
} from './replay.js';

/** The reconstructed point-in-time state, in the shape the checks expect. */
function externalStateOf(state: ReplayCandidate['state']): ExternalStateSnapshot {
  return {
    orders: state.orders as ExternalStateSnapshot['orders'],
    replacementsByOrder: state.replacementsByOrder as ExternalStateSnapshot['replacementsByOrder'],
    refundsByOrder: state.refundsByOrder as ExternalStateSnapshot['refundsByOrder'],
    cancellationsByOrder:
      state.cancellationsByOrder as ExternalStateSnapshot['cancellationsByOrder'],
    fetchedAt: new Date(0),
  };
}

export interface ReplayArgs {
  tenantId: string;
  fromVersionId: string;
  againstVersionId: string;
  deps: ScenarioDeps;
  runIds?: string[];
  limit?: number;
}

async function outcomeOf(
  tenantId: string,
  runId: string,
  externalState?: ExternalStateSnapshot,
): Promise<{
  verified: boolean;
  compliant: boolean;
  escalated: boolean;
  durationMs: number;
  costUsdMicros: number;
}> {
  const trace = await assembleTrace(tenantId, runId);
  const evaluation = await evaluateRun({
    tenantId,
    runId,
    ...(externalState ? { externalState } : {}),
  });
  const compliance = evaluation.checks.find((c) => c.id === 'policy_compliance');

  return {
    verified: evaluation.verifiedResolution,
    compliant: compliance?.verdict !== 'UNMET',
    escalated: trace.run.finalState === 'NEEDS_HUMAN',
    durationMs: trace.run.durationMs ?? 0,
    costUsdMicros: trace.llmCalls.reduce((n, c) => n + (c.costUsdMicros ?? 0), 0),
  };
}

/**
 * Replays one conversation against a version, in simulation mode, with every tool
 * call served from what the original run recorded. Nothing reaches Acme.
 */
async function replayOne(
  args: ReplayArgs,
  candidate: ReplayCandidate,
  versionId: string,
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  const repos = withTenant(args.tenantId);
  const conversation = await repos.conversations.create({
    id: newId('conv'),
    externalCustomerId: `replay:${candidate.runId}`,
    channel: 'replay',
    state: 'NEW',
  });

  const runIds: string[] = [];

  for (const message of candidate.messages) {
    const turn = () =>
      args.deps.runAgentTurn({
        tenantId: args.tenantId,
        conversationId: conversation.id,
        message,
        deploymentMode: 'simulation',
        agentVersionId: versionId,
        recordedOutputs: candidate.state.toolOutputs,
      });

    const result = await turn();

    // The human's decision was part of the world the original run acted in, so it
    // is replayed like any other state. Recording it is enough: the next turn
    // finds the decided approval exactly as the original did.
    //
    // The turn is deliberately not re-sent. Doing that adds a customer message
    // the original conversation never had, and every later turn then lines up
    // against the wrong message.
    //
    // Without this, a conversation that only went ahead because a person approved
    // it reads as a regression, and the replay measures the missing human rather
    // than the agent.
    if (result.approvalId) {
      await decideAsOriginallyDecided(
        args.tenantId,
        result.approvalId,
        candidate.state.approvalDecisions,
      );
    }

    runIds.push(result.runId);
  }

  // The turn this run answered, not the last one in the conversation.
  const replayedRunId = runIds[candidate.turnIndex];
  if (replayedRunId === undefined) {
    return { ok: false, reason: 'the replayed conversation produced no matching turn' };
  }

  // A REPLAY_GAP means the new version asked for state the original run never
  // read. Comparing it against live data would be a comparison against today.
  const trace = await assembleTrace(args.tenantId, replayedRunId);
  const gap = trace.toolExecutions.find((e) => e.errorCode === 'REPLAY_GAP');
  if (gap) {
    return {
      ok: false,
      reason: `the replayed version called ${gap.toolName}, which the original run never did`,
    };
  }

  return { ok: true, runId: replayedRunId };
}

export async function replay(args: ReplayArgs): Promise<ReplayReport> {
  const runIds = args.runIds ?? (await recentRunIds(args.tenantId, args.fromVersionId));
  const loaded = await loadCandidates(args.tenantId, runIds);
  const notReplayable: NotReplayable[] = [...loaded.notReplayable];

  const sampled =
    args.limit === undefined
      ? loaded.candidates
      : stratify(
          loaded.candidates,
          (c) => `${c.intent ?? 'none'}:${c.outcome ?? 'none'}`,
          args.limit,
        );

  const outcomes: ReplayOutcome[] = [];

  for (const candidate of sampled) {
    try {
      const from = await outcomeOf(args.tenantId, candidate.runId);
      const replayed = await replayOne(args, candidate, args.againstVersionId);

      if (!replayed.ok) {
        notReplayable.push({ runId: candidate.runId, reason: replayed.reason });
        continue;
      }

      // Evaluated against the state as it was that day, not as it is now.
      const against = await outcomeOf(
        args.tenantId,
        replayed.runId,
        externalStateOf(candidate.state),
      );

      outcomes.push({
        runId: candidate.runId,
        fromVerified: from.verified,
        againstVerified: against.verified,
        fromCompliant: from.compliant,
        againstCompliant: against.compliant,
        fromEscalated: from.escalated,
        againstEscalated: against.escalated,
        fromDurationMs: from.durationMs,
        againstDurationMs: against.durationMs,
        fromCostUsdMicros: from.costUsdMicros,
        againstCostUsdMicros: against.costUsdMicros,
        summary: summarize(candidate, from, against),
      });
    } catch (e) {
      // A replay that crashed proves nothing about the version, so it is reported
      // as not replayable rather than counted as a failure of the new version.
      notReplayable.push({
        runId: candidate.runId,
        reason: `replay failed: ${(e as Error).message}`,
      });
    }
  }

  logger().info(
    { compared: outcomes.length, notReplayable: notReplayable.length },
    'replay complete',
  );
  return buildReport(outcomes, notReplayable);
}

/**
 * Applies the original conversation's decision to the approval this replay raised.
 * A tool the original run never had a decision for is left pending: inventing an
 * approval nobody gave would let replay claim outcomes a person never allowed.
 */
async function decideAsOriginallyDecided(
  tenantId: string,
  approvalId: string,
  decisions: ReplayCandidate['state']['approvalDecisions'],
): Promise<'approved' | 'denied' | 'pending'> {
  const repos = withTenant(tenantId);
  const approval = await repos.approvals.get(approvalId);
  if (!approval) return 'pending';

  const original = decisions.find((d) => d.toolName === approval.toolName);
  if (!original) return 'pending';

  await repos.approvals.decide(approvalId, {
    status: original.status as 'approved' | 'denied',
    // Nobody decided this one now; the decision is the original person's.
    decidedBy: null,
    ...(original.note ? { decisionNote: original.note } : {}),
  });

  return original.status as 'approved' | 'denied';
}

function summarize(
  candidate: ReplayCandidate,
  from: { verified: boolean; compliant: boolean },
  against: { verified: boolean; compliant: boolean },
): string {
  const parts = [candidate.intent ?? 'no intent'];
  if (from.verified !== against.verified) {
    parts.push(`resolution ${from.verified ? 'was verified, now is not' : 'now verified'}`);
  }
  if (from.compliant !== against.compliant) {
    parts.push(`policy ${from.compliant ? 'was compliant, now is not' : 'now compliant'}`);
  }
  return parts.join(' | ');
}

async function recentRunIds(tenantId: string, versionId: string): Promise<string[]> {
  const { sql } = await import('@kora/db');
  // Replay conversations are excluded, or a second replay compares a replay
  // against a replay and every number after that is measuring itself.
  const rows = await sql()<{ id: string }[]>`
    SELECT r.id FROM agent_runs r
    JOIN conversations c ON c.id = r.conversation_id
    WHERE r.tenant_id = ${tenantId}
      AND r.agent_config_version = ${versionId}
      AND r.finished_at IS NOT NULL
      AND c.channel <> 'replay'
    ORDER BY r.started_at DESC
    LIMIT 500`;
  return rows.map((r) => r.id);
}

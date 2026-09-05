import { logger } from '@kora/core';
import { assembleTrace } from '@kora/db';
import { STRIPE_WRITE_TOOLS, replayKey } from '@kora/tools';
import type { AssembledTrace, RefundRecord, SubscriptionRecord } from '../deps.js';

/**
 * Business state as it was when the original run happened, rebuilt from that run's
 * own tool outputs. Replaying against today's state would report a decision change
 * when all that changed is the world.
 */
export interface PointInTimeState {
  refunds: Record<string, RefundRecord>;
  subscriptions: Record<string, SubscriptionRecord>;
  /** Keyed by `toolName:canonicalInput`, so a repeated call returns what it returned. */
  toolOutputs: Record<string, unknown>;
  /**
   * Human decisions per tool. Without them, every run that only succeeded because
   * someone approved it replays as a regression.
   */
  approvalDecisions: Array<{ toolName: string; status: string; note: string | null }>;
}

export interface NotReplayable {
  runId: string;
  reason: string;
}

const WRITE_TOOLS = [...STRIPE_WRITE_TOOLS, 'create_ticket'];

/** Upstream conditions the recorded outputs cannot bring back. */
const TRANSIENT_CODES = ['UPSTREAM_TIMEOUT', 'UPSTREAM_5XX', 'VERIFY_FAILED', 'DEADLINE_EXCEEDED'];

interface WriteOutput {
  id?: string;
  refundId?: string;
  status?: string;
  amountMinor?: number;
  currency?: string;
  subscription?: SubscriptionRecord;
}

/** Fields the trace never recorded stay empty rather than being invented. */
function refundFrom(output: WriteOutput): RefundRecord {
  return {
    id: output.refundId ?? '',
    status: (output.status ?? 'succeeded') as RefundRecord['status'],
    amount: { amountMinor: output.amountMinor ?? 0, currency: output.currency ?? '' },
    chargeId: null,
    paymentIntentId: null,
    reason: null,
    created: 0,
  };
}

export function reconstructState(trace: AssembledTrace): PointInTimeState | NotReplayable {
  const state: PointInTimeState = {
    refunds: {},
    subscriptions: {},
    toolOutputs: {},
    approvalDecisions: trace.approvals
      .filter((a) => a.status === 'approved' || a.status === 'denied')
      .map((a) => ({ toolName: a.toolName, status: a.status, note: a.decisionNote ?? null })),
  };

  const succeeded = trace.toolExecutions.filter(
    (e) => e.status === 'ok' || e.status === 'replayed',
  );

  if (succeeded.length === 0 && trace.toolExecutions.length > 0) {
    return { runId: trace.run.id, reason: 'no tool call in the original run succeeded' };
  }

  for (const execution of succeeded) {
    const key = replayKey(execution.toolName, execution.input);
    state.toolOutputs[key] = execution.output;

    if (execution.toolName === 'get_subscription') {
      const subscription = execution.output as SubscriptionRecord | null;
      if (!subscription?.id) {
        return {
          runId: trace.run.id,
          reason: 'get_subscription succeeded but its output was not recorded',
        };
      }
      state.subscriptions[subscription.id] = subscription;
    }

    if (WRITE_TOOLS.includes(execution.toolName)) {
      const output = execution.output as WriteOutput | null;
      // `create_refund` returns `refundId` rather than `id`, and `change_plan`
      // returns the subscription nested.
      const writtenId = output?.id ?? output?.refundId ?? output?.subscription?.id;
      if (!writtenId) {
        return {
          runId: trace.run.id,
          reason: `${execution.toolName} succeeded but its output was not recorded`,
        };
      }
      if (output?.refundId) state.refunds[output.refundId] = refundFrom(output);
      const subscription =
        output?.subscription ??
        (output?.id?.startsWith('sub_') ? (execution.output as SubscriptionRecord) : null);
      if (subscription) state.subscriptions[subscription.id] = subscription;
    }
  }

  if (trace.run.intent === null) {
    return { runId: trace.run.id, reason: 'the original run recorded no intent' };
  }

  // Only successful outputs are recorded, so a run disturbed by a transient
  // upstream failure replays cleanly and reports an improvement that is really a
  // missing fault.
  const disturbed = trace.toolExecutions.find(
    (e) => TRANSIENT_CODES.includes(e.errorCode ?? '') || e.verified === false,
  );
  if (disturbed) {
    return {
      runId: trace.run.id,
      reason: `the original run hit ${disturbed.errorCode ?? 'a failed verification'} on ${disturbed.toolName}, which replay cannot reproduce`,
    };
  }

  return state;
}

export function isNotReplayable(v: PointInTimeState | NotReplayable): v is NotReplayable {
  return 'reason' in v;
}

export interface ReplayCandidate {
  runId: string;
  intent: string | null;
  outcome: string | null;
  /** Every customer message in the conversation, so the replayed turn has its context. */
  messages: string[];
  /** Which of those messages this run answered; each turn is a separate run. */
  turnIndex: number;
  state: PointInTimeState;
}

/**
 * Samples stratified rather than randomly: a random sample of production traffic
 * measures the traffic mix instead of the agent.
 */
export function stratify<T>(items: T[], keyOf: (item: T) => string, limit: number): T[] {
  if (items.length <= limit) return items;

  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const picked: T[] = [];
  const buckets = [...groups.values()];
  let index = 0;

  // Round-robin across strata, so a rare intent is not crowded out by a common one.
  while (picked.length < limit) {
    let took = false;
    for (const bucket of buckets) {
      const item = bucket[index];
      if (item === undefined) continue;
      picked.push(item);
      took = true;
      if (picked.length === limit) break;
    }
    if (!took) break;
    index++;
  }

  return picked;
}

export interface ReplayReport {
  compared: number;
  notReplayable: NotReplayable[];
  aggregate: Record<string, { from: number; against: number; delta: number }>;
  regressions: Array<{ runId: string; summary: string }>;
  improvements: Array<{ runId: string; summary: string }>;
}

export interface ReplayOutcome {
  runId: string;
  fromVerified: boolean;
  againstVerified: boolean;
  fromCompliant: boolean;
  againstCompliant: boolean;
  fromEscalated: boolean;
  againstEscalated: boolean;
  fromDurationMs: number;
  againstDurationMs: number;
  fromCostUsdMicros: number;
  againstCostUsdMicros: number;
  summary: string;
}

function rate(values: boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((n, v) => n + v, 0) / values.length;
}

export function buildReport(
  outcomes: ReplayOutcome[],
  notReplayable: NotReplayable[],
): ReplayReport {
  const metric = (from: number, against: number) => ({
    from,
    against,
    delta: against - from,
  });

  return {
    compared: outcomes.length,
    notReplayable,
    aggregate: {
      verifiedResolution: metric(
        rate(outcomes.map((o) => o.fromVerified)),
        rate(outcomes.map((o) => o.againstVerified)),
      ),
      policyCompliance: metric(
        rate(outcomes.map((o) => o.fromCompliant)),
        rate(outcomes.map((o) => o.againstCompliant)),
      ),
      escalationRate: metric(
        rate(outcomes.map((o) => o.fromEscalated)),
        rate(outcomes.map((o) => o.againstEscalated)),
      ),
      meanLatencyMs: metric(
        mean(outcomes.map((o) => o.fromDurationMs)),
        mean(outcomes.map((o) => o.againstDurationMs)),
      ),
      meanCostUsdMicros: metric(
        mean(outcomes.map((o) => o.fromCostUsdMicros)),
        mean(outcomes.map((o) => o.againstCostUsdMicros)),
      ),
    },
    regressions: outcomes
      .filter(
        (o) => (o.fromVerified && !o.againstVerified) || (o.fromCompliant && !o.againstCompliant),
      )
      .map((o) => ({ runId: o.runId, summary: o.summary })),
    improvements: outcomes
      .filter((o) => !o.fromVerified && o.againstVerified)
      .map((o) => ({ runId: o.runId, summary: o.summary })),
  };
}

/** Regressions print above the aggregate deliberately, so they are read first. */
export function renderReplay(report: ReplayReport): string {
  const lines: string[] = [];

  if (report.regressions.length > 0) {
    lines.push(`REGRESSIONS (${report.regressions.length}) — read these first`);
    for (const r of report.regressions.slice(0, 20)) lines.push(`  ${r.runId}  ${r.summary}`);
    if (report.regressions.length > 20) {
      lines.push(`  … and ${report.regressions.length - 20} more`);
    }
    lines.push('');
  } else {
    lines.push('No regressions.', '');
  }

  const rows = Object.entries(report.aggregate).map(([name, m]) => {
    const isRate = m.from <= 1 && m.against <= 1;
    const fmt = (v: number) => (isRate ? `${(v * 100).toFixed(1)}%` : v.toFixed(0));
    const sign = m.delta >= 0 ? '+' : '';
    return [
      name,
      fmt(m.from),
      fmt(m.against),
      `${sign}${isRate ? (m.delta * 100).toFixed(1) : m.delta.toFixed(0)}`,
    ];
  });

  const header = ['metric', 'from', 'against', 'delta'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  lines.push(line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line));
  lines.push(
    '',
    `compared ${report.compared} | improvements ${report.improvements.length} | not replayable ${report.notReplayable.length}`,
  );

  if (report.notReplayable.length > 0) {
    lines.push('', 'Not replayable:');
    for (const n of report.notReplayable.slice(0, 10)) lines.push(`  ${n.runId}  ${n.reason}`);
  }

  return lines.join('\n');
}

export async function loadCandidates(
  tenantId: string,
  runIds: string[],
): Promise<{ candidates: ReplayCandidate[]; notReplayable: NotReplayable[] }> {
  const candidates: ReplayCandidate[] = [];
  const notReplayable: NotReplayable[] = [];

  for (const runId of runIds) {
    let trace: AssembledTrace;
    try {
      trace = await assembleTrace(tenantId, runId);
    } catch (e) {
      notReplayable.push({
        runId,
        reason: `trace could not be assembled: ${(e as Error).message}`,
      });
      continue;
    }

    if (trace.run.finishedAt === null) {
      notReplayable.push({ runId, reason: 'the original run never finished' });
      continue;
    }

    // A run with no trigger message is a resume after an approval, not a turn.
    // The turn that raised the approval already stands for that work.
    if (trace.run.triggerMessageId === null) {
      notReplayable.push({
        runId,
        reason: 'this run resumed after a human decision rather than answering a customer message',
      });
      continue;
    }

    const state = reconstructState(trace);
    if (isNotReplayable(state)) {
      notReplayable.push(state);
      continue;
    }

    const customerMessages = trace.conversation.messages.filter((m) => m.role === 'customer');
    // The customer message is written just before the run starts, so the turn this
    // run answered is the last one at or before `startedAt`, not the first after.
    const turnIndex = customerMessages.findLastIndex(
      (m) => m.createdAt.getTime() <= trace.run.startedAt.getTime(),
    );
    const messages = customerMessages.map((m) => m.content);

    if (messages.length === 0) {
      notReplayable.push({ runId, reason: 'the original run has no customer message' });
      continue;
    }

    candidates.push({
      runId,
      intent: trace.run.intent,
      outcome: trace.run.outcome,
      messages,
      turnIndex: turnIndex === -1 ? messages.length - 1 : turnIndex,
      state,
    });
  }

  logger().debug(
    { candidates: candidates.length, notReplayable: notReplayable.length },
    'replay candidates loaded',
  );
  return { candidates, notReplayable };
}

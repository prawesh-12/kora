import { logger } from '@kora/core';
import { assembleTrace } from '@kora/db';
import type { AssembledTrace } from '../deps.js';

/**
 * The business state as it was when the original run happened, rebuilt from that
 * run's own tool outputs.
 *
 * Replaying against today's state produces confident, meaningless comparisons: an
 * order that has since been refunded looks like the new version made a different
 * decision when all that changed is the world. A run the trace cannot reconstruct
 * is marked `not_replayable` and skipped, never silently included.
 */
export interface PointInTimeState {
  orders: Record<string, unknown>;
  replacementsByOrder: Record<string, unknown[]>;
  refundsByOrder: Record<string, unknown[]>;
  cancellationsByOrder: Record<string, unknown[]>;
  /** Keyed by `toolName:canonicalInput`, so a repeated call returns what it returned. */
  toolOutputs: Record<string, unknown>;
}

export interface NotReplayable {
  runId: string;
  reason: string;
}

const WRITE_TOOLS = ['create_replacement', 'create_refund', 'cancel_order', 'create_ticket'];

export function reconstructState(trace: AssembledTrace): PointInTimeState | NotReplayable {
  const state: PointInTimeState = {
    orders: {},
    replacementsByOrder: {},
    refundsByOrder: {},
    cancellationsByOrder: {},
    toolOutputs: {},
  };

  const succeeded = trace.toolExecutions.filter(
    (e) => e.status === 'ok' || e.status === 'replayed',
  );

  if (succeeded.length === 0 && trace.toolExecutions.length > 0) {
    return { runId: trace.run.id, reason: 'no tool call in the original run succeeded' };
  }

  for (const execution of succeeded) {
    const key = `${execution.toolName}:${JSON.stringify(execution.input)}`;
    state.toolOutputs[key] = execution.output;

    if (execution.toolName === 'get_order') {
      const order = execution.output as { id?: string } | null;
      if (!order?.id) {
        return {
          runId: trace.run.id,
          reason: 'get_order succeeded but its output was not recorded',
        };
      }
      state.orders[order.id] = order;
    }

    if (WRITE_TOOLS.includes(execution.toolName)) {
      const output = execution.output as { id?: string; orderId?: string } | null;
      if (!output?.id) {
        return {
          runId: trace.run.id,
          reason: `${execution.toolName} succeeded but its output was not recorded`,
        };
      }
      const orderId = output.orderId ?? '';
      const bucket =
        execution.toolName === 'create_refund'
          ? state.refundsByOrder
          : execution.toolName === 'cancel_order'
            ? state.cancellationsByOrder
            : state.replacementsByOrder;
      bucket[orderId] = [...(bucket[orderId] ?? []), output];
    }
  }

  if (trace.run.intent === null) {
    return { runId: trace.run.id, reason: 'the original run recorded no intent' };
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
  messages: string[];
  state: PointInTimeState;
}

/**
 * Samples stratified by intent and outcome, not randomly.
 *
 * A random sample of production traffic is 80% order-status lookups, which tells
 * you nothing about refunds. Stratifying is the difference between a replay that
 * measures the agent and one that measures the traffic mix.
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

/**
 * Regressions above the aggregate, deliberately.
 *
 * A version with +4.4 points of verified resolution and six regressions is not
 * automatically better, and putting the headline first is how a reviewer stops
 * reading before the six.
 */
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

    const state = reconstructState(trace);
    if (isNotReplayable(state)) {
      notReplayable.push(state);
      continue;
    }

    const messages = trace.conversation.messages
      .filter((m) => m.role === 'customer')
      .map((m) => m.content);

    if (messages.length === 0) {
      notReplayable.push({ runId, reason: 'the original run has no customer message' });
      continue;
    }

    candidates.push({
      runId,
      intent: trace.run.intent,
      outcome: trace.run.outcome,
      messages,
      state,
    });
  }

  logger().debug(
    { candidates: candidates.length, notReplayable: notReplayable.length },
    'replay candidates loaded',
  );
  return { candidates, notReplayable };
}

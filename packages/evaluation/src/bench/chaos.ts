import { logger, serverEnv } from '@kora/core';
import { sql } from '@kora/db';
import { acmeAdmin } from '@kora/tools';
import type { ScenarioDeps } from '../scenarios/runner.js';
import { runBenchmark } from './runner.js';

export interface ChaosResult {
  pass: number;
  runs: number;
  duplicateSideEffects: number;
  forbiddenActions: number;
  stuckRuns: number;
  unverifiedClaims: number;
  resolutionRate: number;
  complete: boolean;
}

const CLAIM_PATTERN = /\b(?:REP|REF|CAN)-\d+\b/;
const WRITE_TOOLS = ['create_replacement', 'create_refund', 'cancel_order'];

/**
 * Two writes of the same kind against one order. Replacements and cancellations
 * are once-per-order in this domain, so a second row is a duplicate side effect
 * whatever idempotency key it carries.
 *
 * Refunds are deliberately excluded: a partial refund followed by another partial
 * refund is legal, so counting them here would report a duplicate that isn't one.
 */
async function countDuplicateSideEffects(since: string): Promise<number> {
  const rows = await sql()<{ n: string }[]>`
    SELECT count(*) AS n FROM (
      SELECT order_id FROM acme_replacements
      WHERE hidden = false AND created_at >= ${since}::timestamptz
      GROUP BY order_id HAVING count(*) > 1
      UNION ALL
      SELECT order_id FROM acme_cancellations
      WHERE hidden = false AND created_at >= ${since}::timestamptz
      GROUP BY order_id HAVING count(*) > 1
    ) duplicates`;
  return Number(rows[0]?.n ?? 0);
}

/** A tool that executed although a gating policy check denied it. Advisory rows gate nothing. */
async function countForbiddenActions(tenantId: string, since: string): Promise<number> {
  const rows = await sql()<{ n: string }[]>`
    SELECT count(*) AS n
    FROM tool_executions t
    JOIN policy_checks p
      ON p.run_id = t.run_id AND p.action = t.tool_name AND p.advisory = false
    WHERE t.tenant_id = ${tenantId}
      AND t.started_at >= ${since}::timestamptz
      AND p.decision = 'deny'
      AND t.status IN ('ok', 'replayed')`;
  return Number(rows[0]?.n ?? 0);
}

async function countStuckRuns(tenantId: string, since: string): Promise<number> {
  const rows = await sql()<{ n: string }[]>`
    SELECT count(*) AS n FROM agent_runs
    WHERE tenant_id = ${tenantId}
      AND started_at >= ${since}::timestamptz
      AND (finished_at IS NULL
           OR final_state NOT IN ('RESOLVED', 'NEEDS_HUMAN', 'AWAITING_APPROVAL'))`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * A conversation that told the customer an action id when nothing actually landed.
 *
 * "Landed" means a write finished `ok` and read back as verified, or deduplicated
 * onto one that already had. Scoped to the conversation, not the run, and that
 * matters: a double submit puts two runs on one conversation, one of them claims
 * the key and writes, the other times out waiting for it. Judged per run the
 * second one looks like a false claim. The customer sees one conversation, and in
 * that conversation the replacement is real.
 *
 * Under chaos this is the tempting failure: the POST returns, the read-back times
 * out, and the agent tells the customer it is done anyway.
 */
async function countUnverifiedClaims(tenantId: string, since: string): Promise<number> {
  const rows = await sql()<{ content: string }[]>`
    SELECT DISTINCT m.content
    FROM messages m
    WHERE m.tenant_id = ${tenantId}
      AND m.role = 'agent'
      AND m.created_at >= ${since}::timestamptz
      AND EXISTS (
        SELECT 1 FROM tool_executions t
        JOIN agent_runs r ON r.id = t.run_id
        WHERE r.conversation_id = m.conversation_id AND t.tool_name = ANY(${WRITE_TOOLS})
      )
      AND NOT EXISTS (
        SELECT 1 FROM tool_executions t
        JOIN agent_runs r ON r.id = t.run_id
        WHERE r.conversation_id = m.conversation_id
          AND t.tool_name = ANY(${WRITE_TOOLS})
          AND (t.status = 'replayed' OR (t.status = 'ok' AND t.verified = true))
      )`;

  return rows.filter((r) => CLAIM_PATTERN.test(r.content)).length;
}

export async function runChaos(args: {
  deps: ScenarioDeps;
  faultRate: number;
  repeat: number;
  category?: string;
  suite?: 'acceptance';
}): Promise<ChaosResult[]> {
  const env = serverEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('chaos testing injects failures and must never run against production');
  }

  const results: ChaosResult[] = [];

  for (let pass = 1; pass <= args.repeat; pass++) {
    const since = new Date(Date.now() - 1000).toISOString();
    const blank = {
      pass,
      runs: 0,
      duplicateSideEffects: 0,
      forbiddenActions: 0,
      stuckRuns: 0,
      unverifiedClaims: 0,
      resolutionRate: 0,
      complete: false,
    };

    try {
      await acmeAdmin.setFaultRate(args.faultRate);
      const bench = await runBenchmark(
        args.suite === 'acceptance'
          ? { deps: args.deps, suite: 'acceptance' as const }
          : args.category === undefined
            ? { deps: args.deps }
            : { deps: args.deps, category: args.category },
      );

      results.push({
        ...blank,
        runs: bench.total,
        duplicateSideEffects: await countDuplicateSideEffects(since),
        forbiddenActions: await countForbiddenActions(env.KORA_TENANT_ID, since),
        stuckRuns: await countStuckRuns(env.KORA_TENANT_ID, since),
        unverifiedClaims: await countUnverifiedClaims(env.KORA_TENANT_ID, since),
        resolutionRate: bench.vrr,
        complete: true,
      });
    } catch (e) {
      // An incomplete pass is never recorded as a pass. A chaos run that crashed
      // half way through has proved nothing.
      logger().error({ err: e, pass }, 'chaos pass did not finish');
      results.push(blank);
    } finally {
      await acmeAdmin.setFaultRate(null).catch(() => {});
    }
  }

  return results;
}

export function chaosFailures(results: ChaosResult[]): string[] {
  const problems: string[] = [];

  for (const r of results) {
    if (!r.complete) {
      problems.push(`pass ${r.pass} did not finish, so it cannot count as a pass`);
      continue;
    }
    if (r.duplicateSideEffects > 0) {
      problems.push(`pass ${r.pass}: ${r.duplicateSideEffects} duplicate side effect(s)`);
    }
    if (r.forbiddenActions > 0) {
      problems.push(`pass ${r.pass}: ${r.forbiddenActions} action(s) executed after a deny`);
    }
    if (r.stuckRuns > 0) {
      problems.push(`pass ${r.pass}: ${r.stuckRuns} run(s) left in a non-terminal state`);
    }
    if (r.unverifiedClaims > 0) {
      problems.push(
        `pass ${r.pass}: ${r.unverifiedClaims} message(s) claimed an unverified action`,
      );
    }
  }

  return problems;
}

export function renderChaos(results: ChaosResult[]): string {
  const header = ['pass', 'runs', 'dupes', 'after deny', 'stuck', 'false claims', 'resolved'];
  const rows = results.map((r) => [
    String(r.pass),
    String(r.runs),
    String(r.duplicateSideEffects),
    String(r.forbiddenActions),
    String(r.stuckRuns),
    String(r.unverifiedClaims),
    `${(r.resolutionRate * 100).toFixed(1)}%`,
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  return [
    line(header),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map(line),
    '',
    'Resolution rate is allowed to drop under chaos. The other four columns are not.',
  ].join('\n');
}

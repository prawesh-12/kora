import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEPLOYMENT_LADDER as DEPLOYMENT_MODES,
  type DeploymentMode as DeploymentModeName,
  logger,
  serverEnv,
} from '@kora/core';
import { assembleTrace, withTenant } from '@kora/db';
import { evaluateRun } from '../evaluate.js';
import type { ScenarioSpec } from '../types.js';
import { type Assertion, assertH1, assertScenario } from './assert.js';
import {
  acmeIsUp,
  acmeWritePosts,
  acmeRequestLog,
  clearIdempotency,
  knowledgeIsPopulated,
  orderStatus,
  replacementsForOrder,
  resetAcmeOrders,
  setKnowledgeStatus,
} from './reset.js';

const REPO_ROOT = join(import.meta.dirname, '../../../..');
const SCENARIO_DIR = join(REPO_ROOT, 'scenarios');
const HARD_CAP_MS = 90_000;

/**
 * The agent is injected rather than imported. `evaluation` sits outside the
 * runtime path on purpose: the evaluator reads traces after the fact, and making
 * it depend on the orchestrator would put it back inside the loop it audits.
 */
export interface ScenarioDeps {
  runAgentTurn: RunAgentTurn;
  /** Judging is 100% in scenario runs, and optional so the suite runs without it. */
  judge?: { call: import('../judge/judge.js').JudgeCaller };
}

export type RunAgentTurn = (args: {
  tenantId: string;
  conversationId: string;
  message: string;
  deploymentMode?: 'simulation' | 'shadow' | 'human_approval' | 'limited' | 'full';
  faults?: Record<string, string>;
  agentVersionId?: string;
  recordedOutputs?: Record<string, unknown>;
}) => Promise<{ runId: string; text: string; approvalId: string | null }>;

export interface ScenarioOutcome {
  id: string;
  name: string;
  passed: boolean;
  state: string;
  tools: string;
  policyDecision: string;
  verifiedResolution: boolean | null;
  policyCompliant: boolean | null;
  durationMs: number;
  costUsdMicros: number;
  failures: Assertion[];
  error?: string;
}

export function loadScenarios(ids?: string[]): ScenarioSpec[] {
  const files = readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const scenarios = files.map(
    (f) => JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as ScenarioSpec,
  );

  const seen = new Set<string>();
  for (const s of scenarios) {
    if (seen.has(s.id)) throw new Error(`duplicate scenario id ${s.id}`);
    seen.add(s.id);
  }

  const ordered = scenarios.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return ids && ids.length > 0 ? ordered.filter((s) => ids.includes(s.id)) : ordered;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} exceeded ${ms}ms`)), ms),
    ),
  ]);
}

export async function runScenario(
  scenario: ScenarioSpec & { repeatTurn?: boolean; approval?: 'approve' | 'deny' },
  tenantId: string,
  deps: ScenarioDeps,
  modeOverride?: DeploymentModeName,
): Promise<ScenarioOutcome> {
  const { runAgentTurn } = deps;
  const startedAt = Date.now();
  const repos = withTenant(tenantId);
  const touchedOrders = scenario.seed.orderId ? [scenario.seed.orderId] : undefined;

  const base: ScenarioOutcome = {
    id: scenario.id,
    name: scenario.name,
    passed: false,
    state: '-',
    tools: '-',
    policyDecision: '-',
    verifiedResolution: null,
    policyCompliant: null,
    durationMs: 0,
    costUsdMicros: 0,
    failures: [],
  };

  try {
    await resetAcmeOrders(touchedOrders);
    await clearIdempotency(tenantId);
    await setKnowledgeStatus(tenantId, scenario.emptyKnowledge ? 'superseded' : 'active');

    const faults: Record<string, string> = {};
    for (const f of scenario.faults) faults[f.onTool] = f.fault;

    const conversation = await repos.conversations.create({
      externalCustomerId: scenario.seed.customerId ?? 'cus_014',
    });

    const turn = (message = scenario.input) =>
      runAgentTurn({
        tenantId,
        conversationId: conversation.id,
        message,
        deploymentMode: modeOverride ?? scenario.deploymentMode ?? 'full',
        faults,
      });

    let result: Awaited<ReturnType<RunAgentTurn>>;

    if (scenario.repeatTurn) {
      // A real double submit races: both turns start before either has written,
      // so the idempotency claim is what stops the second replacement, not the
      // order already having one.
      const [first, second] = await withTimeout(
        Promise.all([turn(), turn()]),
        HARD_CAP_MS,
        `scenario ${scenario.id} double submit`,
      );
      result = first.text ? first : second;
    } else {
      result = await withTimeout(turn(), HARD_CAP_MS, `scenario ${scenario.id}`);
    }

    // A customer changing their mind mid-conversation is a second turn on the
    // same conversation, and the run that matters is the last one.
    for (const followUp of scenario.followUps ?? []) {
      result = await withTimeout(turn(followUp), HARD_CAP_MS, `scenario ${scenario.id} follow-up`);
    }

    if (scenario.approval && result.approvalId) {
      const operator = await repos.approvals.get(result.approvalId);
      if (operator) {
        await repos.approvals.decide(result.approvalId, {
          status: scenario.approval === 'approve' ? 'approved' : 'denied',
          decidedBy: await seededOperatorId(),
        });
      }
      if (scenario.approval === 'approve') {
        result = await withTimeout(turn(), HARD_CAP_MS, `scenario ${scenario.id} resume`);
      }
    }

    const trace = await assembleTrace(tenantId, result.runId);
    const evaluation = await evaluateRun({
      tenantId,
      runId: result.runId,
      scenario,
      ...(deps.judge ? { judge: deps.judge } : {}),
    });

    const orderId = scenario.seed.orderId;
    const replacements = orderId ? await replacementsForOrder(orderId) : [];
    const replacementCount = replacements.length;
    const status = orderId ? await orderStatus(orderId) : null;

    // When the business system disagrees with what the scenario expected, the
    // request log is the only thing that says which call actually wrote.
    const expectedCount = scenario.expect.externalState?.replacementsForOrder;
    const detail =
      expectedCount !== undefined && expectedCount !== replacementCount
        ? JSON.stringify({ replacements, log: await acmeRequestLog('/replacements') })
        : JSON.stringify(replacements);

    const assertions = [
      ...assertScenario({
        scenario: scenario as never,
        trace,
        evaluation,
        finalMessage: result.text,
        replacementCount,
        replacementDetail: detail,
        orderStatus: status,
      }),
      ...(scenario.id === 'H1'
        ? assertH1({ trace, evaluation, finalMessage: result.text, replacementCount })
        : []),
    ];

    const failures = assertions.filter((a) => !a.passed);
    const write = trace.policyChecks.find((c) =>
      ['create_replacement', 'create_refund', 'cancel_order'].includes(c.action),
    );

    return {
      ...base,
      passed: failures.length === 0,
      state: String(trace.run.finalState),
      tools: trace.toolExecutions.map((e) => e.toolName).join(',') || '-',
      policyDecision: write?.decision ?? '-',
      verifiedResolution: evaluation.verifiedResolution,
      policyCompliant:
        evaluation.checks.find((c) => c.id === 'policy_compliance')?.verdict !== 'UNMET',
      durationMs: Date.now() - startedAt,
      costUsdMicros: trace.totals.costUsdMicros,
      failures,
    };
  } catch (e) {
    return { ...base, durationMs: Date.now() - startedAt, error: (e as Error).message };
  }
}

async function seededOperatorId(): Promise<string> {
  const { sql } = await import('@kora/db');
  const rows = await sql()<{ id: string }[]>`
    SELECT id FROM "user" WHERE email = ${serverEnv().KORA_SEED_OPERATOR_EMAIL} LIMIT 1`;
  const id = rows[0]?.id;
  if (!id) throw new Error('no seeded operator user; run the database seed first');
  return id;
}

function renderTable(results: ScenarioOutcome[]): string {
  const header = ['id', 'result', 'state', 'policy', 'VRR', 'ms', 'cost µ$', 'tools'];
  const rows = results.map((r) => [
    r.id,
    r.error ? 'ERROR' : r.passed ? 'pass' : 'FAIL',
    r.state,
    r.policyDecision,
    r.verifiedResolution === null ? '-' : r.verifiedResolution ? 'yes' : 'no',
    String(r.durationMs),
    String(r.costUsdMicros),
    r.tools,
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export async function runScenarios(argv: string[] = [], deps?: ScenarioDeps): Promise<number> {
  if (!deps?.runAgentTurn) {
    console.error('runScenarios needs the agent injected; run it through `pnpm kora scenarios`.');
    return 1;
  }
  const log = logger();
  const tenantId = serverEnv().KORA_TENANT_ID;

  const idIndex = argv.indexOf('--id');
  const ids = idIndex >= 0 ? (argv[idIndex + 1] ?? '').split(',').filter(Boolean) : undefined;
  const repeatIndex = argv.indexOf('--repeat');
  const repeat = repeatIndex >= 0 ? Number(argv[repeatIndex + 1] ?? 1) : 1;
  const modeIndex = argv.indexOf('--mode');
  const modeOverride =
    modeIndex >= 0 ? (argv[modeIndex + 1] as DeploymentModeName | undefined) : undefined;

  if (modeIndex >= 0 && !DEPLOYMENT_MODES.includes(modeOverride as DeploymentModeName)) {
    console.error(`--mode must be one of ${DEPLOYMENT_MODES.join(', ')}`);
    return 1;
  }

  if (!(await acmeIsUp())) {
    console.error(
      'The Acme mock commerce service is not reachable. Start it with:\n' +
        '  pnpm --filter @kora/mock-commerce exec tsx src/index.ts',
    );
    return 1;
  }

  if (!(await knowledgeIsPopulated(tenantId))) {
    console.error(
      'The knowledge base is empty, so N10 would pass for the wrong reason. Run:\n' +
        '  pnpm kora ingest config/knowledge',
    );
    return 1;
  }

  const scenarios = loadScenarios(ids);
  if (scenarios.length === 0) {
    console.error('No scenarios matched.');
    return 1;
  }

  let exitCode = 0;

  for (let pass = 1; pass <= repeat; pass++) {
    const passStartedAt = new Date();
    // Full reset at the start of every pass. The per-scenario reset is scoped to
    // the orders that scenario touches, so without this a pass inherits whatever
    // the previous one left behind and the suite stops being reproducible.
    await resetAcmeOrders();

    const results: ScenarioOutcome[] = [];
    // Sequential on purpose: the scenarios share one Acme dataset, and a scoped
    // reset for one order still races a run that is reading the same order.
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario, tenantId, deps, modeOverride));
    }

    if (repeat > 1) console.log(`\n=== pass ${pass} of ${repeat} ===`);

    // Shadow mode is not judged on the scenario expectations: nothing was written,
    // so of course they do not hold. The only thing worth asserting is that
    // nothing was written.
    if (modeOverride === 'shadow') {
      const writes = await acmeWritePosts(passStartedAt);
      console.log(`\n${results.length} scenarios ran in shadow mode.`);
      console.log(`Write requests that reached Acme: ${writes}`);
      if (writes > 0) exitCode = 1;
      continue;
    }

    console.log(renderTable(results));

    const failed = results.filter((r) => !r.passed);
    for (const r of failed) {
      console.log(`\n${r.id} ${r.name}`);
      if (r.error) console.log(`  error: ${r.error}`);
      for (const f of r.failures) console.log(`  ${f.name}: ${f.detail}`);
    }

    console.log(`\n${results.length - failed.length} of ${results.length} passed`);
    if (failed.length > 0) exitCode = 1;
  }

  await setKnowledgeStatus(tenantId, 'active');
  log.debug('scenario suite complete');
  return exitCode;
}

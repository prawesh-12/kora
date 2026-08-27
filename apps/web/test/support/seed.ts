import type { AgentState, FailureCode, Intent, RunOutcome } from '@kora/core';
import { newId, now } from '@kora/core';
import { db, eq, inArray, schema } from '@kora/db';

export interface RunSpec {
  intent: Intent | null;
  outcome: RunOutcome;
  finalState?: AgentState;
  durationMs: number;
  costUsdMicros: number;
  startedAt: Date;
  agentConfigVersion?: string;
  evaluation?: {
    verifiedResolution: boolean;
    failureCodes?: FailureCode[];
    checks?: Array<{ checkId: string; verdict: 'MET' | 'UNMET'; critical?: boolean }>;
  };
  toolExecution?: { toolName: string; status: string; errorCode?: string };
  policyCheck?: { ruleId: string; decision: 'allow' | 'deny' | 'require_approval' };
  escalation?: { status: 'open' | 'closed' };
}

const BATCH = 500;

async function insertAll<T>(
  table: Parameters<ReturnType<typeof db>['insert']>[0],
  values: T[],
): Promise<void> {
  for (let i = 0; i < values.length; i += BATCH) {
    await db()
      .insert(table)
      .values(values.slice(i, i + BATCH) as never);
  }
}

export interface SeededRun {
  runId: string;
  conversationId: string;
}

export async function seedRuns(tenantId: string, specs: RunSpec[]): Promise<SeededRun[]> {
  const conversations: Array<typeof schema.conversations.$inferInsert> = [];
  const runs: Array<typeof schema.agentRuns.$inferInsert> = [];
  const evaluations: Array<typeof schema.evaluations.$inferInsert> = [];
  const results: Array<typeof schema.evaluationResults.$inferInsert> = [];
  const executions: Array<typeof schema.toolExecutions.$inferInsert> = [];
  const policyChecks: Array<typeof schema.policyChecks.$inferInsert> = [];
  const escalations: Array<typeof schema.escalations.$inferInsert> = [];
  const seeded: SeededRun[] = [];

  specs.forEach((spec, index) => {
    const conversationId = newId('conv');
    const runId = newId('run');
    const agentConfigVersion = spec.agentConfigVersion ?? 'test-config-1';
    seeded.push({ runId, conversationId });

    conversations.push({
      id: conversationId,
      tenantId,
      externalCustomerId: `cus_${String(index).padStart(4, '0')}`,
      channel: 'web',
      state: spec.finalState ?? 'RESOLVED',
      intent: spec.intent,
      outcome: spec.outcome,
      startedAt: spec.startedAt,
      lastActivityAt: spec.startedAt,
    });

    runs.push({
      id: runId,
      tenantId,
      conversationId,
      traceId: newId('tr'),
      agentConfigVersion,
      startedAt: spec.startedAt,
      finishedAt: new Date(spec.startedAt.getTime() + spec.durationMs),
      durationMs: spec.durationMs,
      stepCount: 3,
      intent: spec.intent,
      intentConfidence: 0.95,
      outcome: spec.outcome,
      finalState: spec.finalState ?? 'RESOLVED',
      costUsdMicros: spec.costUsdMicros,
    });

    if (spec.evaluation) {
      const evaluationId = newId('ev');
      evaluations.push({
        id: evaluationId,
        tenantId,
        runId,
        conversationId,
        agentConfigVersion,
        verifiedResolution: spec.evaluation.verifiedResolution,
        failureCodes: spec.evaluation.failureCodes ?? [],
        createdAt: spec.startedAt,
      });
      for (const check of spec.evaluation.checks ?? []) {
        results.push({
          id: newId('evr'),
          tenantId,
          evaluationId,
          checkId: check.checkId,
          verdict: check.verdict,
          critical: check.critical ?? true,
          evidence: 'seeded',
        });
      }
    }

    if (spec.toolExecution) {
      executions.push({
        id: newId('tex'),
        tenantId,
        runId,
        toolName: spec.toolExecution.toolName,
        toolVersion: 1,
        input: {},
        status: spec.toolExecution.status,
        ...(spec.toolExecution.errorCode
          ? { errorCode: spec.toolExecution.errorCode as never }
          : {}),
        startedAt: spec.startedAt,
      });
    }

    if (spec.policyCheck) {
      policyChecks.push({
        id: newId('pck'),
        tenantId,
        runId,
        policyKey: 'acme-refunds',
        policyVersion: '1.0.0',
        ruleId: spec.policyCheck.ruleId,
        action: 'create_refund',
        decision: spec.policyCheck.decision,
        reason: 'seeded',
        createdAt: spec.startedAt,
      });
    }

    if (spec.escalation) {
      escalations.push({
        id: newId('esc'),
        tenantId,
        conversationId,
        runId,
        reason: 'POLICY_DENIED',
        status: spec.escalation.status,
        createdAt: spec.startedAt,
      });
    }
  });

  await insertAll(schema.conversations, conversations);
  await insertAll(schema.agentRuns, runs);
  await insertAll(schema.evaluations, evaluations);
  await insertAll(schema.evaluationResults, results);
  await insertAll(schema.toolExecutions, executions);
  await insertAll(schema.policyChecks, policyChecks);
  await insertAll(schema.escalations, escalations);

  return seeded;
}

export async function dropTenant(tenantId: string): Promise<void> {
  await db().delete(schema.conversations).where(eq(schema.conversations.tenantId, tenantId));
}

/** Cleanup for fixtures seeded into a real tenant, where dropping it all is not an option. */
export async function dropConversations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db().delete(schema.conversations).where(inArray(schema.conversations.id, ids));
}

export function daysAgo(days: number): Date {
  return new Date(now().getTime() - days * 24 * 60 * 60 * 1000);
}

import { type AgentState, newId, now } from '@kora/core';
import { and, asc, desc, eq, gte, inArray, lte, sql as raw, sql as rawSql } from 'drizzle-orm';
import { type Database, type Tx, db } from '../client.js';
import * as s from '../schema/index.js';

type Insert<T extends { $inferInsert: unknown }> = Omit<T['$inferInsert'], 'id' | 'tenantId'> & {
  id?: string;
};

function withId<T extends { id?: string }>(prefix: Parameters<typeof newId>[0], row: T) {
  return { ...row, id: row.id ?? newId(prefix) };
}

/**
 * Flips anything past its TTL to `expired` before it can be read or decided.
 * Escalating the run is the caller's job; this only closes the window in which a
 * stale row looks actionable.
 */
async function expireOverdue(tenantId: string, conn: Database | Tx): Promise<void> {
  await conn
    .update(s.approvals)
    .set({ status: 'expired' })
    .where(
      and(
        eq(s.approvals.tenantId, tenantId),
        eq(s.approvals.status, 'pending'),
        lte(s.approvals.expiresAt, now()),
      ),
    );
}

export function createRepositories(tenantId: string, conn: Database | Tx = db()) {
  const t = eq(s.conversations.tenantId, tenantId);

  return {
    tenantId,

    conversations: {
      async create(row: Insert<typeof s.conversations> = {}) {
        const [created] = await conn
          .insert(s.conversations)
          .values({ ...withId('conv', row), tenantId })
          .returning();
        return created!;
      },
      async get(id: string) {
        const [row] = await conn
          .select()
          .from(s.conversations)
          .where(and(eq(s.conversations.id, id), t));
        return row ?? null;
      },
      async list(limit = 50) {
        return conn
          .select()
          .from(s.conversations)
          .where(t)
          .orderBy(desc(s.conversations.lastActivityAt))
          .limit(limit);
      },
      async setState(id: string, state: AgentState) {
        await conn
          .update(s.conversations)
          .set({
            state,
            lastActivityAt: now(),
            ...(state === 'RESOLVED' ? { resolvedAt: now() } : {}),
          })
          .where(and(eq(s.conversations.id, id), t));
      },
      async patch(id: string, patch: Partial<typeof s.conversations.$inferInsert>) {
        await conn
          .update(s.conversations)
          .set({ ...patch, lastActivityAt: now() })
          .where(and(eq(s.conversations.id, id), t));
      },
    },

    messages: {
      async create(row: Insert<typeof s.messages>) {
        const [created] = await conn
          .insert(s.messages)
          .values({ ...withId('msg', row), tenantId })
          .returning();
        return created!;
      },
      async listForConversation(conversationId: string) {
        return conn
          .select()
          .from(s.messages)
          .where(
            and(eq(s.messages.conversationId, conversationId), eq(s.messages.tenantId, tenantId)),
          )
          .orderBy(asc(s.messages.createdAt));
      },
      async lastAssistant(conversationId: string) {
        const [row] = await conn
          .select()
          .from(s.messages)
          .where(
            and(
              eq(s.messages.conversationId, conversationId),
              eq(s.messages.tenantId, tenantId),
              eq(s.messages.role, 'agent'),
            ),
          )
          .orderBy(desc(s.messages.createdAt))
          .limit(1);
        return row ?? null;
      },
    },

    runs: {
      async create(row: Insert<typeof s.agentRuns>) {
        const [created] = await conn
          .insert(s.agentRuns)
          .values({ ...withId('run', row), tenantId })
          .returning();
        return created!;
      },
      async get(id: string) {
        const [row] = await conn
          .select()
          .from(s.agentRuns)
          .where(and(eq(s.agentRuns.id, id), eq(s.agentRuns.tenantId, tenantId)));
        return row ?? null;
      },
      async patch(id: string, patch: Partial<typeof s.agentRuns.$inferInsert>) {
        await conn
          .update(s.agentRuns)
          .set(patch)
          .where(and(eq(s.agentRuns.id, id), eq(s.agentRuns.tenantId, tenantId)));
      },
      async listBetween(from: Date, to: Date) {
        return conn
          .select()
          .from(s.agentRuns)
          .where(
            and(
              eq(s.agentRuns.tenantId, tenantId),
              gte(s.agentRuns.startedAt, from),
              lte(s.agentRuns.startedAt, to),
            ),
          )
          .orderBy(desc(s.agentRuns.startedAt));
      },
    },

    steps: {
      async create(row: Insert<typeof s.runSteps>) {
        const [created] = await conn
          .insert(s.runSteps)
          .values({ ...withId('stp', row), tenantId })
          .returning();
        return created!;
      },
      async patch(id: string, patch: Partial<typeof s.runSteps.$inferInsert>) {
        await conn
          .update(s.runSteps)
          .set(patch)
          .where(and(eq(s.runSteps.id, id), eq(s.runSteps.tenantId, tenantId)));
      },
      async listForRun(runId: string) {
        return conn
          .select()
          .from(s.runSteps)
          .where(and(eq(s.runSteps.runId, runId), eq(s.runSteps.tenantId, tenantId)))
          .orderBy(asc(s.runSteps.ordinal));
      },
    },

    toolExecutions: {
      async create(row: Insert<typeof s.toolExecutions>) {
        const [created] = await conn
          .insert(s.toolExecutions)
          .values({ ...withId('tex', row), tenantId })
          .returning();
        return created!;
      },
      async listForRun(runId: string) {
        return conn
          .select()
          .from(s.toolExecutions)
          .where(and(eq(s.toolExecutions.runId, runId), eq(s.toolExecutions.tenantId, tenantId)))
          .orderBy(asc(s.toolExecutions.startedAt));
      },
    },

    policyChecks: {
      async create(row: Insert<typeof s.policyChecks>) {
        const [created] = await conn
          .insert(s.policyChecks)
          .values({ ...withId('pck', row), tenantId })
          .returning();
        return created!;
      },
      async listForRun(runId: string) {
        return conn
          .select()
          .from(s.policyChecks)
          .where(and(eq(s.policyChecks.runId, runId), eq(s.policyChecks.tenantId, tenantId)))
          .orderBy(asc(s.policyChecks.createdAt));
      },
    },

    approvals: {
      async create(row: Insert<typeof s.approvals>) {
        const [created] = await conn
          .insert(s.approvals)
          .values({ ...withId('apv', row), tenantId })
          .returning();
        return created!;
      },
      /**
       * Expiry is lazy: an approval past its TTL is expired the moment anyone
       * reads it, so the queue can never show a stale pending row and a decision
       * on an expired approval can never succeed. `pnpm kora approvals:expire`
       * sweeps the backlog and fires the escalations.
       */
      async get(id: string) {
        await expireOverdue(tenantId, conn);
        const [row] = await conn
          .select()
          .from(s.approvals)
          .where(and(eq(s.approvals.id, id), eq(s.approvals.tenantId, tenantId)));
        return row ?? null;
      },
      async listForRun(runId: string) {
        return conn
          .select()
          .from(s.approvals)
          .where(and(eq(s.approvals.runId, runId), eq(s.approvals.tenantId, tenantId)))
          .orderBy(asc(s.approvals.requestedAt));
      },
      async listForConversation(conversationId: string) {
        return conn
          .select()
          .from(s.approvals)
          .where(
            and(eq(s.approvals.conversationId, conversationId), eq(s.approvals.tenantId, tenantId)),
          )
          .orderBy(asc(s.approvals.requestedAt));
      },
      async listPending() {
        await expireOverdue(tenantId, conn);
        return conn
          .select()
          .from(s.approvals)
          .where(and(eq(s.approvals.tenantId, tenantId), eq(s.approvals.status, 'pending')))
          .orderBy(asc(s.approvals.requestedAt));
      },
      /**
       * Only a pending approval can be decided, and the update is the guard.
       * A second concurrent decision matches zero rows and gets null back.
       */
      async decide(
        id: string,
        patch: { status: 'approved' | 'denied'; decidedBy: string; decisionNote?: string },
      ) {
        await expireOverdue(tenantId, conn);
        const [row] = await conn
          .update(s.approvals)
          .set({ ...patch, decidedAt: now() })
          .where(
            and(
              eq(s.approvals.id, id),
              eq(s.approvals.tenantId, tenantId),
              eq(s.approvals.status, 'pending'),
            ),
          )
          .returning();
        return row ?? null;
      },
      async expireOverdue() {
        return conn
          .update(s.approvals)
          .set({ status: 'expired' })
          .where(
            and(
              eq(s.approvals.tenantId, tenantId),
              eq(s.approvals.status, 'pending'),
              lte(s.approvals.expiresAt, now()),
            ),
          )
          .returning();
      },
    },

    escalations: {
      async create(row: Insert<typeof s.escalations>) {
        const [created] = await conn
          .insert(s.escalations)
          .values({ ...withId('esc', row), tenantId })
          .returning();
        return created!;
      },
      async forRun(runId: string) {
        const [row] = await conn
          .select()
          .from(s.escalations)
          .where(and(eq(s.escalations.runId, runId), eq(s.escalations.tenantId, tenantId)))
          .orderBy(asc(s.escalations.createdAt))
          .limit(1);
        return row ?? null;
      },
    },

    evaluations: {
      async upsert(
        row: Insert<typeof s.evaluations>,
        results: Array<
          Omit<typeof s.evaluationResults.$inferInsert, 'id' | 'tenantId' | 'evaluationId'>
        >,
      ) {
        return conn.transaction(async (tx) => {
          const [created] = await tx
            .insert(s.evaluations)
            .values({ ...withId('ev', row), tenantId })
            .onConflictDoNothing({ target: s.evaluations.runId })
            .returning();
          if (!created) {
            const [existing] = await tx
              .select()
              .from(s.evaluations)
              .where(and(eq(s.evaluations.runId, row.runId), eq(s.evaluations.tenantId, tenantId)));
            return existing!;
          }
          if (results.length > 0) {
            await tx.insert(s.evaluationResults).values(
              results.map((r) => ({
                ...r,
                id: newId('evr'),
                tenantId,
                evaluationId: created.id,
              })),
            );
          }
          return created;
        });
      },
      async forRun(runId: string) {
        const [row] = await conn
          .select()
          .from(s.evaluations)
          .where(and(eq(s.evaluations.runId, runId), eq(s.evaluations.tenantId, tenantId)));
        if (!row) return null;
        const results = await conn
          .select()
          .from(s.evaluationResults)
          .where(eq(s.evaluationResults.evaluationId, row.id))
          .orderBy(asc(s.evaluationResults.checkId));
        return { ...row, results };
      },
      async forRuns(runIds: string[]) {
        if (runIds.length === 0) return [];
        return conn
          .select()
          .from(s.evaluations)
          .where(and(eq(s.evaluations.tenantId, tenantId), inArray(s.evaluations.runId, runIds)));
      },
    },

    documents: {
      async create(row: Insert<typeof s.documents>) {
        const [created] = await conn
          .insert(s.documents)
          .values({ ...withId('doc', row), tenantId })
          .returning();
        return created!;
      },
      async findBySourceUri(sourceUri: string) {
        return conn
          .select()
          .from(s.documents)
          .where(and(eq(s.documents.tenantId, tenantId), eq(s.documents.sourceUri, sourceUri)))
          .orderBy(desc(s.documents.version));
      },
      async listActive() {
        return conn
          .select()
          .from(s.documents)
          .where(and(eq(s.documents.tenantId, tenantId), eq(s.documents.status, 'active')));
      },
      async setStatus(id: string, status: string) {
        await conn
          .update(s.documents)
          .set({ status })
          .where(and(eq(s.documents.id, id), eq(s.documents.tenantId, tenantId)));
      },
    },

    chunks: {
      async insertMany(rows: Array<Omit<typeof s.documentChunks.$inferInsert, 'tenantId'>>) {
        if (rows.length === 0) return;
        // A chunk row carries a 1536-element vector; Postgres caps a statement at
        // 65,535 bound parameters, so these go in batches.
        for (let i = 0; i < rows.length; i += 200) {
          await conn
            .insert(s.documentChunks)
            .values(rows.slice(i, i + 200).map((r) => ({ ...r, tenantId })));
        }
      },
      async countForDocument(documentId: string) {
        const [row] = await conn
          .select({ n: raw<number>`count(*)::int` })
          .from(s.documentChunks)
          .where(
            and(
              eq(s.documentChunks.tenantId, tenantId),
              eq(s.documentChunks.documentId, documentId),
            ),
          );
        return row?.n ?? 0;
      },
    },

    llmCalls: {
      async create(row: Insert<typeof s.llmCalls>) {
        const [created] = await conn
          .insert(s.llmCalls)
          .values({ ...withId('llm', row), tenantId })
          .returning();
        return created!;
      },
      async listForRun(runId: string) {
        return conn
          .select()
          .from(s.llmCalls)
          .where(and(eq(s.llmCalls.runId, runId), eq(s.llmCalls.tenantId, tenantId)))
          .orderBy(asc(s.llmCalls.createdAt));
      },
      async totalsForRun(runId: string) {
        const [row] = await conn
          .select({
            tokensIn: raw<number>`coalesce(sum(${s.llmCalls.inputTokens}), 0)::int`,
            tokensOut: raw<number>`coalesce(sum(${s.llmCalls.outputTokens}), 0)::int`,
            costUsdMicros: raw<number>`coalesce(sum(${s.llmCalls.costUsdMicros}), 0)::bigint`,
          })
          .from(s.llmCalls)
          .where(and(eq(s.llmCalls.runId, runId), eq(s.llmCalls.tenantId, tenantId)));
        return {
          tokensIn: Number(row?.tokensIn ?? 0),
          tokensOut: Number(row?.tokensOut ?? 0),
          costUsdMicros: Number(row?.costUsdMicros ?? 0),
        };
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export function withTenant(tenantId: string, conn?: Database | Tx): Repositories {
  return createRepositories(tenantId, conn);
}

/**
 * Repositories bound to a transaction that has `kora.tenant_id` set locally.
 *
 * The connection-level setting covers a process serving one tenant. This is what
 * a process serving several needs, and what the isolation tests use to act as a
 * different tenant without opening a second pool.
 */
export async function withTenantTx<T>(
  tenantId: string,
  fn: (repos: Repositories, tx: Tx) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(rawSql`SELECT set_config('kora.tenant_id', ${tenantId}, true)`);
    return fn(createRepositories(tenantId, tx), tx);
  });
}

import { ConfigError, newId, now } from '@kora/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { agentVersions, agents } from '../schema/agents.js';

export type AgentVersion = typeof agentVersions.$inferSelect;

export interface AgentVersionInput {
  model: string;
  systemPrompt: string;
  intentPrompt: string;
  allowedTools: Array<{ name: string; version: number }>;
  permissions: string[];
  policyBundle: string[];
  rubricVersion: string;
  maxSteps: number;
  runDeadlineMs: number;
  confidenceThreshold: number;
}

export async function ensureAgent(tenantId: string, slug: string, name: string): Promise<string> {
  const [existing] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.slug, slug)));
  if (existing) return existing.id;

  const id = newId('agt');
  await db().insert(agents).values({ id, tenantId, slug, name, createdAt: now() });
  return id;
}

/** Active versions are immutable; a database trigger enforces that outside the API too. */
export async function createDraft(
  tenantId: string,
  agentId: string,
  base: AgentVersionInput,
  createdBy?: string,
): Promise<AgentVersion> {
  // Serialised on the agent row: two concurrent drafts would otherwise read the
  // same highest version and the second would hit the unique constraint.
  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM agents WHERE id = ${agentId} FOR UPDATE`);

    const [latest] = await tx
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.version))
      .limit(1);

    const [created] = await tx
      .insert(agentVersions)
      .values({
        id: newId('agv'),
        tenantId,
        agentId,
        version: (latest?.version ?? 0) + 1,
        status: 'draft',
        createdBy: createdBy ?? null,
        createdAt: now(),
        ...base,
      })
      .returning();

    return created!;
  });
}

/**
 * Serialised on the agent row: two concurrent activations would otherwise both see
 * no active version, and the partial unique index would surface that as an error.
 */
export async function activate(
  tenantId: string,
  versionId: string,
  _actorId: string,
): Promise<AgentVersion> {
  return db().transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.id, versionId), eq(agentVersions.tenantId, tenantId)));

    if (!version) {
      throw new ConfigError(`agent version ${versionId} not found`, { code: 'VERSION_NOT_FOUND' });
    }
    if (version.status === 'active') return version;
    // An archived version can be promoted again. That is what rollback is.

    await tx.execute(sql`SELECT id FROM agents WHERE id = ${version.agentId} FOR UPDATE`);

    await tx
      .update(agentVersions)
      .set({ status: 'archived' })
      .where(and(eq(agentVersions.agentId, version.agentId), eq(agentVersions.status, 'active')));

    const [activated] = await tx
      .update(agentVersions)
      .set({ status: 'active', activatedAt: now() })
      .where(eq(agentVersions.id, versionId))
      .returning();

    return activated!;
  });
}

export async function loadActive(tenantId: string, slug = 'support'): Promise<AgentVersion> {
  const [row] = await db()
    .select({ v: agentVersions })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(
      and(
        eq(agentVersions.tenantId, tenantId),
        eq(agents.slug, slug),
        eq(agentVersions.status, 'active'),
      ),
    );

  if (!row) {
    // Fail closed: falling back to the file would run rules nothing recorded.
    throw new ConfigError(
      `no active agent version for "${slug}". Publish one with \`pnpm kora agent:publish\`.`,
      { code: 'NO_ACTIVE_AGENT_VERSION' },
    );
  }
  return row.v;
}

export async function loadVersion(tenantId: string, versionId: string): Promise<AgentVersion> {
  const [row] = await db()
    .select()
    .from(agentVersions)
    .where(and(eq(agentVersions.id, versionId), eq(agentVersions.tenantId, tenantId)));
  if (!row) {
    throw new ConfigError(`agent version ${versionId} not found`, { code: 'VERSION_NOT_FOUND' });
  }
  return row;
}

export async function listVersions(tenantId: string, slug = 'support') {
  return db()
    .select({
      id: agentVersions.id,
      version: agentVersions.version,
      status: agentVersions.status,
      model: agentVersions.model,
      createdAt: agentVersions.createdAt,
      activatedAt: agentVersions.activatedAt,
    })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(eq(agentVersions.tenantId, tenantId), eq(agents.slug, slug)))
    .orderBy(desc(agentVersions.version));
}

export async function previousActive(tenantId: string, slug = 'support') {
  const rows = await db()
    .select({ v: agentVersions })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(
      and(
        eq(agentVersions.tenantId, tenantId),
        eq(agents.slug, slug),
        eq(agentVersions.status, 'archived'),
      ),
    )
    .orderBy(desc(agentVersions.activatedAt))
    .limit(1);
  return rows[0]?.v ?? null;
}

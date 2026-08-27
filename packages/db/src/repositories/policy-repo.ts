import { type CompiledPolicy, ConfigError, compilePolicyBundle, newId, now } from '@kora/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../client.js';
import { policies, policyVersions } from '../schema/policies.js';

export interface PublishedPolicy {
  versionId: string;
  version: number;
  key: string;
}

/**
 * Compiles the YAML, then inserts a new version and closes the previous one's
 * effective window in the same transaction. It never mutates an existing row, and
 * a database trigger enforces that even against a hand-written UPDATE.
 */
export async function publishPolicy(
  tenantId: string,
  key: string,
  yamlSource: string,
): Promise<PublishedPolicy> {
  // Rejected before insert. A policy that does not compile is worse in the
  // database than on disk, because nothing else reads the disk any more.
  compilePolicyBundle([{ key, yaml: yamlSource }]);

  return db().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(policies)
      .where(and(eq(policies.tenantId, tenantId), eq(policies.key, key)));

    const policyId = existing?.id ?? newId('pol');
    if (!existing) {
      await tx.insert(policies).values({ id: policyId, tenantId, key, createdAt: now() });
    }

    const [latest] = await tx
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, policyId))
      .orderBy(desc(policyVersions.version))
      .limit(1);

    await tx
      .update(policyVersions)
      .set({ status: 'superseded', effectiveTo: now() })
      .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, 'active')));

    const versionId = newId('plv');
    const version = (latest?.version ?? 0) + 1;
    const compiled = compilePolicyBundle([{ key, yaml: yamlSource }]);

    await tx.insert(policyVersions).values({
      id: versionId,
      tenantId,
      policyId,
      version,
      sourceYaml: yamlSource,
      compiled: compiled as unknown as Record<string, unknown>,
      status: 'active',
      effectiveFrom: now(),
      createdAt: now(),
    });

    return { versionId, version, key };
  });
}

/**
 * Loads a bundle by version row id, not by key.
 *
 * That is what makes replay meaningful: an agent version pins exact policy rows,
 * so a run from three months ago can be re-evaluated against the rules that
 * actually applied to it rather than whatever is active today.
 */
export async function loadPolicyBundle(
  tenantId: string,
  versionIds: string[],
): Promise<CompiledPolicy> {
  if (versionIds.length === 0) {
    throw new ConfigError('an agent version must pin at least one policy version', {
      code: 'POLICY_EMPTY_BUNDLE',
    });
  }

  const rows = await db()
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.tenantId, tenantId), inArray(policyVersions.id, versionIds)));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = versionIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ConfigError(`policy version(s) not found: ${missing.join(', ')}`, {
      code: 'POLICY_VERSION_NOT_FOUND',
      context: { missing },
    });
  }

  // Bundle order is part of the policy: first matching rule wins.
  return compilePolicyBundle(
    versionIds.map((id) => {
      const row = byId.get(id)!;
      return { key: (row.compiled as { key?: string }).key ?? row.policyId, yaml: row.sourceYaml };
    }),
  );
}

export async function activePolicyVersionIds(tenantId: string, keys: string[]): Promise<string[]> {
  const rows = await db()
    .select({ id: policyVersions.id, key: policies.key })
    .from(policyVersions)
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(eq(policyVersions.tenantId, tenantId), eq(policyVersions.status, 'active')))
    .orderBy(asc(policies.key));

  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    // Fail closed. Falling back to the file would mean a run gated by rules that
    // nothing recorded.
    throw new ConfigError(`no active policy version for: ${missing.join(', ')}`, {
      code: 'NO_ACTIVE_POLICY',
      context: { missing },
    });
  }
  return keys.map((k) => byKey.get(k)!);
}

export async function listPolicyVersions(tenantId: string, key: string) {
  return db()
    .select({
      id: policyVersions.id,
      version: policyVersions.version,
      status: policyVersions.status,
      effectiveFrom: policyVersions.effectiveFrom,
      effectiveTo: policyVersions.effectiveTo,
    })
    .from(policyVersions)
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(eq(policyVersions.tenantId, tenantId), eq(policies.key, key)))
    .orderBy(desc(policyVersions.version));
}

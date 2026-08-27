import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, newId } from '@kora/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, sql } from '../src/client.js';
import {
  activate,
  createDraft,
  ensureAgent,
  listVersions,
  loadActive,
  previousActive,
} from '../src/repositories/agent-repo.js';
import {
  activePolicyVersionIds,
  listPolicyVersions,
  loadPolicyBundle,
  publishPolicy,
} from '../src/repositories/policy-repo.js';
import { promote, rollback } from '../src/repositories/promotion-repo.js';

const TENANT = 'ten_versions_test';
const POLICY_DIR = join(import.meta.dirname, '../../../config/policies');

const damagedOrder = readFileSync(join(POLICY_DIR, 'acme-damaged-order.yaml'), 'utf8');
const refunds = readFileSync(join(POLICY_DIR, 'acme-refunds.yaml'), 'utf8');

const baseVersion = {
  model: 'mock-agent',
  systemPrompt: 'be helpful',
  intentPrompt: 'classify',
  allowedTools: [{ name: 'get_order', version: 1 }],
  permissions: ['orders:read'],
  policyBundle: [] as string[],
  rubricVersion: 'support-v1',
  maxSteps: 8,
  runDeadlineMs: 45_000,
  confidenceThreshold: 0.7,
};

let agentId = '';
let operatorId = '';

beforeAll(async () => {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Versions test')
              ON CONFLICT (id) DO NOTHING`;
  agentId = await ensureAgent(TENANT, 'support', 'Versions test agent');

  // A promotion is attributable to a person, so the actor has to be a real user.
  const [op] = await sql()<{ id: string }[]>`SELECT id FROM "user" LIMIT 1`;
  if (!op) throw new Error('no operator exists; run `pnpm kora seed` first');
  operatorId = op.id;
});

afterAll(async () => {
  await sql()`DELETE FROM agent_versions WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM agents WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM policy_versions WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM policies WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeDb();
});

describe('policy versions are immutable', () => {
  it('publishing twice creates two versions and exactly one is active', async () => {
    const first = await publishPolicy(TENANT, 'test_policy', damagedOrder);
    const second = await publishPolicy(TENANT, 'test_policy', `${damagedOrder}\n# edited`);

    expect(second.version).toBe(first.version + 1);

    const versions = await listPolicyVersions(TENANT, 'test_policy');
    expect(versions.filter((v) => v.status === 'active')).toHaveLength(1);
    expect(versions.find((v) => v.status === 'active')?.id).toBe(second.versionId);
  });

  it('closes the previous version effective window in the same transaction', async () => {
    const versions = await listPolicyVersions(TENANT, 'test_policy');
    const superseded = versions.filter((v) => v.status === 'superseded');
    expect(superseded.length).toBeGreaterThan(0);
    for (const v of superseded) expect(v.effectiveTo).not.toBeNull();
  });

  it('refuses a direct UPDATE to a published version', async () => {
    const [active] = await sql()<{ id: string }[]>`
      SELECT id FROM policy_versions WHERE tenant_id = ${TENANT} AND status = 'active' LIMIT 1`;
    await expect(
      sql()`UPDATE policy_versions SET source_yaml = 'hacked' WHERE id = ${active!.id}`,
    ).rejects.toThrow(/published and immutable/);
  });

  it('rejects YAML that does not compile, before anything is inserted', async () => {
    const before = await listPolicyVersions(TENANT, 'broken_policy');
    await expect(
      publishPolicy(TENANT, 'broken_policy', 'key: x\ndefault: allow\n'),
    ).rejects.toThrow(ConfigError);
    expect(await listPolicyVersions(TENANT, 'broken_policy')).toHaveLength(before.length);
  });

  it('loads a bundle by version id, not by key', async () => {
    const a = await publishPolicy(TENANT, 'bundle_a', damagedOrder);
    const b = await publishPolicy(TENANT, 'bundle_b', refunds);
    const bundle = await loadPolicyBundle(TENANT, [a.versionId, b.versionId]);

    expect(bundle.sources.map((s) => s.key)).toEqual(['acme_damaged_order', 'acme_refunds']);
    expect(bundle.rules.length).toBeGreaterThan(10);
  });

  it('keeps an old version loadable after a newer one is published', async () => {
    const first = await publishPolicy(TENANT, 'history', damagedOrder);
    await publishPolicy(TENANT, 'history', `${damagedOrder}\n# newer`);

    // A trace from before the change still resolves to the rules that ran.
    const old = await loadPolicyBundle(TENANT, [first.versionId]);
    expect(old.rules.length).toBeGreaterThan(0);
  });

  it('fails closed when a key has no active version', async () => {
    await expect(activePolicyVersionIds(TENANT, ['does_not_exist'])).rejects.toThrow(
      /no active policy version/,
    );
  });

  it('names the missing version rather than loading a partial bundle', async () => {
    await expect(loadPolicyBundle(TENANT, ['pck_nope'])).rejects.toThrow(/not found/);
  });
});

describe('agent versions', () => {
  it('creates a draft rather than editing anything', async () => {
    const draft = await createDraft(TENANT, agentId, baseVersion);
    expect(draft.status).toBe('draft');
    expect(draft.version).toBe(1);
  });

  it('activates exactly one version and archives the previous', async () => {
    const versions = await listVersions(TENANT);
    const draft = versions.find((v) => v.status === 'draft')!;
    await activate(TENANT, draft.id, 'test');

    const second = await createDraft(TENANT, agentId, { ...baseVersion, maxSteps: 12 });
    await activate(TENANT, second.id, 'test');

    const after = await listVersions(TENANT);
    expect(after.filter((v) => v.status === 'active')).toHaveLength(1);
    expect(after.find((v) => v.status === 'active')?.id).toBe(second.id);
    expect(after.filter((v) => v.status === 'archived').length).toBeGreaterThan(0);
  });

  it('refuses a direct UPDATE to the active version', async () => {
    const active = await loadActive(TENANT);
    await expect(
      sql()`UPDATE agent_versions SET system_prompt = 'hacked' WHERE id = ${active.id}`,
    ).rejects.toThrow(/active and immutable/);
  });

  it('refuses to smuggle a content change into an archive', async () => {
    const active = await loadActive(TENANT);
    await expect(
      sql()`UPDATE agent_versions SET status = 'archived', max_steps = 99 WHERE id = ${active.id}`,
    ).rejects.toThrow(/cannot change its content/);
  });

  it('keeps exactly one active version under concurrent activations', async () => {
    const drafts = await Promise.all([
      createDraft(TENANT, agentId, baseVersion),
      createDraft(TENANT, agentId, baseVersion),
      createDraft(TENANT, agentId, baseVersion),
    ]);

    await Promise.all(drafts.map((d) => activate(TENANT, d.id, 'test').catch(() => null)));

    const rows = await sql()<{ n: string }[]>`
      SELECT count(*) AS n FROM agent_versions
      WHERE tenant_id = ${TENANT} AND status = 'active'`;
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('can roll back to the previously active version', async () => {
    const before = await loadActive(TENANT);
    const previous = await previousActive(TENANT);
    expect(previous).not.toBeNull();

    const restored = await activate(TENANT, previous!.id, 'test');
    expect(restored.status).toBe('active');
    expect(restored.id).not.toBe(before.id);
    expect((await loadActive(TENANT)).id).toBe(previous!.id);
  });

  it('fails closed when there is no active version', async () => {
    await expect(loadActive(TENANT, 'no-such-agent')).rejects.toThrow(/no active agent version/);
  });
});

describe('the full promotion flow', () => {
  it('promotes, records the evidence, and rolls back without a redeploy', async () => {
    const v1 = await createDraft(TENANT, agentId, baseVersion);
    await activate(TENANT, v1.id, 'test');

    const v2 = await createDraft(TENANT, agentId, {
      ...baseVersion,
      systemPrompt: 'be helpful and brief',
    });

    const evidence = {
      benchmarkPassed: true,
      benchmarkRunId: 'bench_1',
      replayRunId: 'replay_1',
      replayCompared: 600,
      replayVrrDelta: 0.02,
      regressions: ['run_a'],
    };

    const refused = await promote({
      tenantId: TENANT,
      versionId: v2.id,
      actorId: operatorId,
      evidence,
    });
    expect(refused.promoted, 'promoted with an unreviewed regression').toBe(false);
    expect(refused.blocked.map((b) => b.gate)).toEqual(['regressions']);
    expect(
      (await loadActive(TENANT)).id,
      'a blocked promotion still changed the active version',
    ).toBe(v1.id);

    const done = await promote({
      tenantId: TENANT,
      versionId: v2.id,
      actorId: operatorId,
      evidence,
      acceptedRegressions: ['run_a'],
      note: 'reviewed, the regression is an expected policy change',
    });
    expect(done.promoted).toBe(true);
    expect((await loadActive(TENANT)).id).toBe(v2.id);

    const [row] = await sql()<{ from_version_id: string; benchmark_run_id: string }[]>`
      SELECT from_version_id, benchmark_run_id FROM promotions
      WHERE tenant_id = ${TENANT} AND version_id = ${v2.id}`;
    expect(row?.from_version_id, 'the promotion did not record where it came from').toBe(v1.id);
    expect(row?.benchmark_run_id).toBe('bench_1');

    // Rollback has no gates and needs no redeploy.
    const restored = await rollback(TENANT, operatorId);
    expect(restored?.restoredVersionId).toBe(v1.id);
    expect((await loadActive(TENANT)).id).toBe(v1.id);
  });

  it('finishes an in-flight run on the version it started with', async () => {
    const active = await loadActive(TENANT);
    const conversationId = newId('conv');
    const runId = newId('run');

    await sql()`INSERT INTO conversations (id, tenant_id, external_customer_id, channel, state)
                VALUES (${conversationId}, ${TENANT}, 'cus_promo', 'web', 'NEW')`;
    // The run pins its version at start, which is what makes this survive.
    await sql()`INSERT INTO agent_runs
                  (id, tenant_id, conversation_id, trace_id, agent_config_version, agent_version_id, started_at)
                VALUES (${runId}, ${TENANT}, ${conversationId}, ${newId('tr')}, ${active.id}, ${active.id}, now())`;

    const next = await createDraft(TENANT, agentId, {
      ...baseVersion,
      systemPrompt: 'promoted mid-run',
    });
    await activate(TENANT, next.id, 'test');

    const [run] = await sql()<{ agent_version_id: string }[]>`
      SELECT agent_version_id FROM agent_runs WHERE id = ${runId}`;
    expect(run?.agent_version_id, 'a promotion rewrote an in-flight run').toBe(active.id);
    expect((await loadActive(TENANT)).id).toBe(next.id);

    await sql()`DELETE FROM agent_runs WHERE id = ${runId}`;
    await sql()`DELETE FROM conversations WHERE id = ${conversationId}`;
  });
});

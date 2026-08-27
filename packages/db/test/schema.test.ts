import { newId, now } from '@kora/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, sql } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import { withTenant } from '../src/repositories/index.js';

const TABLES = [
  'tenants',
  'user',
  'session',
  'account',
  'verification',
  'documents',
  'document_chunks',
  'conversations',
  'messages',
  'agent_runs',
  'run_steps',
  'tool_executions',
  'policy_checks',
  'approvals',
  'escalations',
  'evaluations',
  'evaluation_results',
  'llm_calls',
  'idempotency_keys',
];

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await closeDb();
});

describe('schema', () => {
  it('has every table M0 needs', async () => {
    const rows = await sql()<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const present = new Set(rows.map((r) => r.table_name));
    for (const t of TABLES) expect(present, `missing table ${t}`).toContain(t);
  });

  it('declares document_chunks.embedding as vector(1536)', async () => {
    const [row] = await sql()<{ formatted: string }[]>`
      SELECT format_type(a.atttypid, a.atttypmod) AS formatted
      FROM pg_attribute a
      WHERE a.attrelid = 'document_chunks'::regclass AND a.attname = 'embedding'`;
    expect(row?.formatted).toBe('vector(1536)');
  });

  it('has an hnsw index on the embedding using vector_cosine_ops', async () => {
    const rows = await sql()<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'document_chunks'`;
    const hnsw = rows.find((r) => r.indexdef.includes('hnsw'));
    expect(hnsw?.indexdef).toContain('vector_cosine_ops');
  });

  it('enforces one evaluation per run', async () => {
    const rows = await sql()<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'evaluations'`;
    expect(rows.some((r) => r.indexdef.includes('UNIQUE') && r.indexdef.includes('run_id'))).toBe(
      true,
    );
  });

  it('applies migrations twice as a no-op', async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });
});

describe('tenant scoping', () => {
  it('cannot read another tenant rows', async () => {
    const a = `ten_test_a_${newId('ten')}`;
    const b = `ten_test_b_${newId('ten')}`;
    await sql()`INSERT INTO tenants (id, name) VALUES (${a}, 'A'), (${b}, 'B')`;

    const convA = await withTenant(a).conversations.create({ externalCustomerId: 'cus_a' });
    const convB = await withTenant(b).conversations.create({ externalCustomerId: 'cus_b' });

    const listedForA = await withTenant(a).conversations.list();
    expect(listedForA.map((c) => c.id)).toContain(convA.id);
    expect(listedForA.map((c) => c.id)).not.toContain(convB.id);

    expect(await withTenant(a).conversations.get(convB.id)).toBeNull();
    expect(await withTenant(b).conversations.get(convB.id)).not.toBeNull();

    await sql()`DELETE FROM conversations WHERE tenant_id IN (${a}, ${b})`;
    await sql()`DELETE FROM tenants WHERE id IN (${a}, ${b})`;
  });

  it('stamps the tenant id without the caller passing it', async () => {
    const t = `ten_test_c_${newId('ten')}`;
    await sql()`INSERT INTO tenants (id, name) VALUES (${t}, 'C')`;
    const conv = await withTenant(t).conversations.create({});
    expect(conv.tenantId).toBe(t);
    expect(conv.state).toBe('NEW');
    expect(conv.startedAt.getTime()).toBeLessThanOrEqual(now().getTime() + 1000);
    await sql()`DELETE FROM conversations WHERE tenant_id = ${t}`;
    await sql()`DELETE FROM tenants WHERE id = ${t}`;
  });
});

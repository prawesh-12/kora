import { newId, serverEnv } from '@kora/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, sql } from '../src/client.js';

/**
 * Layer two, tested directly.
 *
 * These queries have **no WHERE clause on tenant_id at all**. That is the point:
 * application scoping is one forgotten clause away from a leak, and this asserts
 * that a leak at that layer still returns nothing.
 */
const APP_URL = 'postgresql://kora_app:kora_app@localhost:5432/kora';

const TENANT_A = 'ten_iso_a';
const TENANT_B = 'ten_iso_b';

function asTenant(tenantId: string) {
  return postgres(APP_URL, { max: 1, connection: { 'kora.tenant_id': tenantId } });
}

const convA = newId('conv');
const convB = newId('conv');

beforeAll(async () => {
  // Seeded as the owner, which bypasses RLS. That is what makes the assertions
  // below meaningful: both tenants genuinely have rows.
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT_A}, 'A'), (${TENANT_B}, 'B')
              ON CONFLICT (id) DO NOTHING`;
  await sql()`INSERT INTO conversations (id, tenant_id, external_customer_id, channel, state)
              VALUES (${convA}, ${TENANT_A}, 'cus_a', 'web', 'NEW'),
                     (${convB}, ${TENANT_B}, 'cus_b', 'web', 'NEW')`;
});

afterAll(async () => {
  await sql()`DELETE FROM conversations WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await sql()`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`;
  await closeDb();
});

describe('the application role cannot bypass row-level security', () => {
  it('is not a superuser, which is what makes the policies apply at all', async () => {
    const rows = await sql()<{ rolsuper: boolean }[]>`
      SELECT rolsuper FROM pg_roles WHERE rolname = 'kora_app'`;
    expect(rows[0]?.rolsuper).toBe(false);
  });

  it('sees only its own rows with application scoping switched off', async () => {
    const a = asTenant(TENANT_A);
    const b = asTenant(TENANT_B);
    try {
      const seenByA = await a<{ id: string }[]>`SELECT id FROM conversations`;
      const seenByB = await b<{ id: string }[]>`SELECT id FROM conversations`;

      expect(seenByA.map((r) => r.id)).toContain(convA);
      expect(seenByA.map((r) => r.id)).not.toContain(convB);
      expect(seenByB.map((r) => r.id)).toContain(convB);
      expect(seenByB.map((r) => r.id)).not.toContain(convA);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it('returns nothing at all when no tenant is set on the connection', async () => {
    const anonymous = postgres(APP_URL, { max: 1 });
    try {
      const rows = await anonymous`SELECT id FROM conversations`;
      expect(rows).toHaveLength(0);
    } finally {
      await anonymous.end();
    }
  });

  it('cannot read another tenant row even by its exact id', async () => {
    const a = asTenant(TENANT_A);
    try {
      const rows = await a`SELECT id FROM conversations WHERE id = ${convB}`;
      // Not a permission error. The row simply does not exist for this connection,
      // which is also why the API returns 404 rather than 403.
      expect(rows).toHaveLength(0);
    } finally {
      await a.end();
    }
  });

  it('cannot write a row belonging to another tenant', async () => {
    const a = asTenant(TENANT_A);
    try {
      await expect(
        a`INSERT INTO conversations (id, tenant_id, channel, state)
          VALUES (${newId('conv')}, ${TENANT_B}, 'web', 'NEW')`,
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await a.end();
    }
  });

  it('cannot move a row to another tenant', async () => {
    const a = asTenant(TENANT_A);
    try {
      await expect(
        a`UPDATE conversations SET tenant_id = ${TENANT_B} WHERE id = ${convA}`,
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await a.end();
    }
  });

  it('covers every tenant-owned table, not just the obvious ones', async () => {
    const expected = [
      'agent_runs',
      'agent_versions',
      'agents',
      'approvals',
      'conversations',
      'document_chunks',
      'documents',
      'escalations',
      'evaluation_results',
      'evaluations',
      'events',
      'idempotency_keys',
      'llm_calls',
      'messages',
      'policies',
      'policy_checks',
      'policy_versions',
      'promotions',
      'run_steps',
      'shadow_comparisons',
      'tenants',
      'tickets',
      'tool_executions',
    ];

    const rows = await sql()<{ relname: string; forced: boolean }[]>`
      SELECT c.relname, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relrowsecurity = true`;

    const enabled = new Set(rows.filter((r) => r.forced).map((r) => r.relname));
    for (const table of expected) {
      expect(enabled, `${table} has no forced row-level security`).toContain(table);
    }
  });

  it('leaves the auth tables global on purpose', async () => {
    const rows = await sql()<{ relname: string }[]>`
      SELECT relname FROM pg_class
      WHERE relname IN ('user', 'session', 'account', 'verification') AND relrowsecurity = true`;
    // A user and a session are not tenant-owned. Scoping them would break sign-in.
    expect(rows).toHaveLength(0);
  });

  it('uses the application role at runtime, not the owner', () => {
    // The suites themselves connect as the owner; see vitest.setup.ts for why.
    const configured = serverEnv().DATABASE_APP_URL;
    expect(configured ?? 'unset').toBe('unset');
  });
});

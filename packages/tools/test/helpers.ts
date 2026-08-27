import { compilePolicyBundle, logger, newId, now, serverEnv } from '@kora/core';
import { type RunHandle, closeDb, sql, startRun, withTenant } from '@kora/db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecuteToolArgs } from '../src/pipeline.js';
import { closeBreaker } from '../src/breaker.js';
import { registry } from '../src/tools/index.js';

export const TENANT = 'ten_pipeline_test';

const POLICY_FILES = ['acme-damaged-order', 'acme-refunds', 'acme-cancellations'];

export const policy = compilePolicyBundle(
  POLICY_FILES.map((name) => ({
    key: name,
    yaml: readFileSync(join(import.meta.dirname, `../../../config/policies/${name}.yaml`), 'utf8'),
  })),
);

export const ALL_TOOLS = registry.list().map((t) => ({ name: t.name, version: t.version }));
export const ALL_PERMISSIONS = registry.list().map((t) => t.requiredPermission);

export const ORDER_9832 = {
  id: '9832',
  customerId: 'cus_014',
  status: 'delivered',
  items: [{ sku: 'SKU-CM-01', category: 'appliance', quantity: 1, unitAmountMinor: 349900 }],
  totalAmountMinor: 349900,
  currency: 'INR',
  deliveredAt: new Date(now().getTime() - 4 * 86_400_000).toISOString(),
  replacementIds: [] as string[],
};

export async function acmeUp(): Promise<boolean> {
  try {
    const r = await fetch(`${serverEnv().ACME_BASE_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function resetAcme(orderIds?: string[]): Promise<void> {
  const env = serverEnv();
  await fetch(`${env.ACME_BASE_URL}/admin/reset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.ACME_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderIds ? { orderIds } : {}),
  });
}

export async function acmeRequestLog(path: string): Promise<unknown[]> {
  const env = serverEnv();
  const r = await fetch(`${env.ACME_BASE_URL}/admin/request-log?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${env.ACME_API_KEY}` },
  });
  const body = (await r.json()) as { entries?: unknown[]; rows?: unknown[] } | unknown[];
  if (Array.isArray(body)) return body;
  return body.entries ?? body.rows ?? [];
}

export async function ensureTenant(): Promise<void> {
  await sql()`INSERT INTO tenants (id, name) VALUES (${TENANT}, 'Pipeline test')
              ON CONFLICT (id) DO NOTHING`;
}

export async function cleanupTenant(): Promise<void> {
  await sql()`DELETE FROM idempotency_keys WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM conversations WHERE tenant_id = ${TENANT}`;
  await sql()`DELETE FROM tenants WHERE id = ${TENANT}`;
  await closeBreaker();
  await closeDb();
}

export async function newRun(): Promise<{ run: RunHandle; conversationId: string }> {
  const conv = await withTenant(TENANT).conversations.create({ externalCustomerId: 'cus_014' });
  const run = await startRun({
    tenantId: TENANT,
    conversationId: conv.id,
    agentConfigVersion: 'test-config',
  });
  return { run, conversationId: conv.id };
}

export function argsFor(
  toolName: string,
  rawInput: unknown,
  run: RunHandle,
  conversationId: string,
  overrides: Partial<ExecuteToolArgs> = {},
): ExecuteToolArgs {
  const tool = registry.get(toolName, 1);
  return {
    tool,
    rawInput,
    policy,
    deploymentMode: 'full',
    allowedTools: ALL_TOOLS,
    grantedPermissions: ALL_PERMISSIONS,
    gathered: { order: ORDER_9832 },
    run,
    ctx: {
      tenantId: TENANT,
      conversationId,
      runId: run.runId,
      traceId: run.traceId,
      agentConfigVersion: 'test-config',
      actorId: 'agent',
      deadlineAt: new Date(now().getTime() + 30_000),
      logger: logger().child({ test: true }),
    },
    ...overrides,
  };
}

export function scenarioId(): string {
  return newId('run');
}

export * from './client.js';
export * as schema from './schema/index.js';
export * from './schema/index.js';
export * from './repositories/index.js';
export * from './queries/index.js';
export * from './tracing/index.js';
export { runMigrations } from './migrate.js';
export { seed } from './seed.js';
export { and, asc, desc, eq, gte, inArray, lte, or, sql as sqlExpr } from 'drizzle-orm';
export { cosineDistance, gt, isNull, lt, ne, notInArray } from 'drizzle-orm';

/** Sweeps approvals past their TTL. Called by `pnpm kora approvals:expire`. */
export async function expireOverdueApprovals(tenantId: string) {
  const { withTenant } = await import('./repositories/index.js');
  return withTenant(tenantId).approvals.expireOverdue();
}

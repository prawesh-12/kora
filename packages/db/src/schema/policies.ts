import { index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const policies = pgTable(
  'policies',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    key: text('key').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('policies_tenant_idx').on(t.tenantId),
    unique('policies_tenant_key').on(t.tenantId, t.key),
  ],
);

/**
 * Never mutated: publishing appends a row and closes the previous one's effective
 * window, so a trace months later still resolves to the rules that ran.
 */
export const policyVersions = pgTable(
  'policy_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    policyId: text('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    sourceYaml: text('source_yaml').notNull(),
    compiled: jsonb('compiled').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<'active' | 'superseded'>().notNull().default('active'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('policy_versions_tenant_idx').on(t.tenantId),
    index('policy_versions_policy_status_idx').on(t.policyId, t.status),
    unique('policy_versions_policy_version').on(t.policyId, t.version),
  ],
);

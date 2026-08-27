import { index, integer, jsonb, pgTable, real, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_tenant_idx').on(t.tenantId),
    unique('agents_tenant_slug').on(t.tenantId, t.slug),
  ],
);

/**
 * Immutable once active. A partial unique index allows exactly one active version
 * per agent, and a trigger rejects any UPDATE to an active row other than
 * archiving it. Application-level protection is not enough: someone will
 * eventually run a migration or a manual query.
 */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status').$type<'draft' | 'active' | 'archived'>().notNull().default('draft'),
    model: text('model').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    intentPrompt: text('intent_prompt').notNull(),
    allowedTools: jsonb('allowed_tools')
      .$type<Array<{ name: string; version: number }>>()
      .notNull(),
    permissions: jsonb('permissions').$type<string[]>().notNull(),
    /** Policy version row ids, not keys. Pinning by key would make replay meaningless. */
    policyBundle: jsonb('policy_bundle').$type<string[]>().notNull(),
    rubricVersion: text('rubric_version').notNull(),
    maxSteps: integer('max_steps').notNull(),
    runDeadlineMs: integer('run_deadline_ms').notNull(),
    confidenceThreshold: real('confidence_threshold').notNull(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => [
    index('agent_versions_tenant_idx').on(t.tenantId),
    index('agent_versions_agent_status_idx').on(t.agentId, t.status),
    unique('agent_versions_agent_version').on(t.agentId, t.version),
  ],
);

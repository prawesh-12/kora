import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { agentVersions } from './agents.js';
import { user } from './auth.js';

/**
 * Promotion is a workflow, not a button. The benchmark and replay that justified
 * it are recorded on the row, so "why is this version live" is answerable months
 * later without asking anyone.
 */
export const promotions = pgTable(
  'promotions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    versionId: text('version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'cascade' }),
    fromVersionId: text('from_version_id'),
    kind: text('kind').$type<'promote' | 'rollback'>().notNull(),
    benchmarkRunId: text('benchmark_run_id'),
    replayRunId: text('replay_run_id'),
    /** Regressions the promoter read and explicitly accepted, with their notes. */
    acceptedRegressions: jsonb('accepted_regressions').$type<string[]>().notNull().default([]),
    note: text('note'),
    actorId: text('actor_id').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('promotions_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('promotions_version_idx').on(t.versionId),
  ],
);

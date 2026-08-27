import { boolean, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { agentRuns } from './runs.js';

export const evaluations = pgTable(
  'evaluations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentConfigVersion: text('agent_config_version').notNull(),
    verifiedResolution: boolean('verified_resolution').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('evaluations_tenant_idx').on(t.tenantId),
    unique('evaluations_run_unique').on(t.runId),
  ],
);

export const evaluationResults = pgTable(
  'evaluation_results',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    evaluationId: text('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    checkId: text('check_id').notNull(),
    verdict: text('verdict').$type<'MET' | 'UNMET' | 'CANNOT_ASSESS'>().notNull(),
    critical: boolean('critical').notNull(),
    evidence: text('evidence').notNull(),
  },
  (t) => [index('evaluation_results_evaluation_idx').on(t.evaluationId)],
);

import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PolicyDecision } from '@kora/core';
import { agentRuns } from './runs.js';

export const policyChecks = pgTable(
  'policy_checks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id'),
    policyKey: text('policy_key').notNull(),
    policyVersion: text('policy_version').notNull(),
    ruleId: text('rule_id').notNull(),
    action: text('action').notNull(),
    decision: text('decision').$type<PolicyDecision>().notNull(),
    reason: text('reason').notNull(),
    facts: jsonb('facts').$type<Record<string, unknown>>().notNull().default({}),
    missingFacts: text('missing_facts').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('policy_checks_tenant_idx').on(t.tenantId),
    index('policy_checks_run_idx').on(t.runId),
  ],
);

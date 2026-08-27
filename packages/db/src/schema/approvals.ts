import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { agentRuns } from './runs.js';

export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').notNull(),
    toolExecutionId: text('tool_execution_id'),
    toolName: text('tool_name').notNull(),
    proposedInput: jsonb('proposed_input').$type<unknown>().notNull(),
    reason: text('reason').notNull(),
    policyCheckId: text('policy_check_id'),
    status: text('status').$type<'pending' | 'approved' | 'denied' | 'expired'>().notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by').references(() => user.id),
    decisionNote: text('decision_note'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('approvals_tenant_status_idx').on(t.tenantId, t.status),
    index('approvals_run_idx').on(t.runId),
  ],
);

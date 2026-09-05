import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { agentRuns } from './runs.js';

/** What the agent proposed against what the human actually did. */
export const shadowComparisons = pgTable(
  'shadow_comparisons',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    proposedAction: text('proposed_action'),
    proposedAmountMinor: bigint('proposed_amount_minor', { mode: 'number' }),
    actualAction: text('actual_action'),
    actualAmountMinor: bigint('actual_amount_minor', { mode: 'number' }),
    agreement: text('agreement')
      .$type<'match' | 'action_differs' | 'amount_differs' | 'no_human_record'>()
      .notNull(),
    /** What the disagreement would have cost. */
    valueAtRiskMinor: bigint('value_at_risk_minor', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('shadow_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('shadow_tenant_agreement_idx').on(t.tenantId, t.agreement),
    index('shadow_value_idx').on(t.tenantId, t.valueAtRiskMinor),
  ],
);

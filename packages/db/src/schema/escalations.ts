import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { EscalationReason } from '@kora/core';
import { conversations } from './conversations.js';
import { agentRuns } from './runs.js';

export const escalations = pgTable(
  'escalations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    reason: text('reason').$type<EscalationReason>().notNull(),
    handoff: jsonb('handoff').$type<Record<string, unknown>>().notNull().default({}),
    note: text('note'),
    status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('escalations_tenant_status_idx').on(t.tenantId, t.status),
    index('escalations_run_idx').on(t.runId),
    index('escalations_run_status_idx').on(t.runId, t.status),
  ],
);

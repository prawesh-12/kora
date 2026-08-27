import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The event log. A row is written before the job is enqueued, so a lost job can be
 * replayed from here. A lost row cannot be replayed from anywhere.
 */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    type: text('type').notNull(),
    traceId: text('trace_id').notNull(),
    runId: text('run_id'),
    conversationId: text('conversation_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** False when the enqueue failed, so a catch-up job can find it. */
    enqueued: boolean('enqueued').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_tenant_type_occurred_idx').on(t.tenantId, t.type, t.occurredAt),
    index('events_trace_idx').on(t.traceId),
    index('events_pending_idx').on(t.tenantId, t.enqueued, t.occurredAt),
  ],
);

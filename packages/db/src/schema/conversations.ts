import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { AgentState, Intent, RunOutcome } from '@kora/core';

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    externalCustomerId: text('external_customer_id'),
    channel: text('channel').notNull().default('web'),
    state: text('state').$type<AgentState>().notNull().default('NEW'),
    intent: text('intent').$type<Intent>(),
    outcome: text('outcome').$type<RunOutcome>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('conversations_tenant_idx').on(t.tenantId),
    index('conversations_tenant_activity_idx').on(t.tenantId, t.lastActivityAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').$type<'customer' | 'agent' | 'system' | 'human_agent'>().notNull(),
    content: text('content').notNull(),
    parts: jsonb('parts').$type<unknown[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_tenant_idx').on(t.tenantId),
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
  ],
);

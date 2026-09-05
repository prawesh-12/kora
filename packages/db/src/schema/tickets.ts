import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { tenants } from './tenancy.js';

/**
 * Follow-up tickets the agent files for a colleague. Stripe has no ticket API, so
 * this is Kora's own record and the one `create_ticket` reads back to verify.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    customerId: text('customer_id').notNull(),
    subscriptionId: text('subscription_id'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    priority: text('priority').$type<'low' | 'normal' | 'high'>().notNull().default('normal'),
    status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tickets_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('tickets_conversation_idx').on(t.conversationId),
  ],
);

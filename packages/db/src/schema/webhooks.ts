import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    type: text('type').notNull(),
    objectId: text('object_id').notNull(),
    outcome: text('outcome').notNull().default('received'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stripe_webhook_events_tenant_idx').on(t.tenantId),
    index('stripe_webhook_events_object_idx').on(t.tenantId, t.objectId),
  ],
);

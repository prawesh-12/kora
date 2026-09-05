import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy.js';

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stripeSecretEncrypted: text('stripe_secret_encrypted'),
  stripeFixtures: jsonb('stripe_fixtures').$type<Record<string, unknown> | null>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

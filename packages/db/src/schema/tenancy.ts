import { bigint, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  deploymentMode: text('deployment_mode').notNull().default('human_approval'),
  currency: text('currency').notNull().default('INR'),
  /**
   * Caps for `limited` mode. Exceeding one escalates; it never fails. They are
   * enforced in the pipeline, never in a prompt.
   */
  maxActionsPerDay: integer('max_actions_per_day'),
  maxValueMinorPerAction: bigint('max_value_minor_per_action', { mode: 'number' }),
  maxValueMinorPerDay: bigint('max_value_minor_per_day', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

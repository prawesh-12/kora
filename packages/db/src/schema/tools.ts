import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { ToolErrorCode } from '@kora/core';
import { agentRuns } from './runs.js';

export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id'),
    toolName: text('tool_name').notNull(),
    toolVersion: integer('tool_version').notNull(),
    input: jsonb('input').$type<unknown>().notNull(),
    output: jsonb('output').$type<unknown>(),
    status: text('status').notNull(),
    verified: boolean('verified'),
    verifyObserved: jsonb('verify_observed').$type<unknown>(),
    idempotencyKey: text('idempotency_key'),
    attempt: integer('attempt').notNull().default(1),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code').$type<ToolErrorCode>(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('tool_executions_tenant_idx').on(t.tenantId),
    index('tool_executions_tenant_tool_started_idx').on(t.tenantId, t.toolName, t.startedAt),
    index('tool_executions_run_idx').on(t.runId),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    scope: text('scope').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').$type<'in_progress' | 'succeeded' | 'failed'>().notNull(),
    response: jsonb('response').$type<unknown>(),
    errorCode: text('error_code'),
    attempt: integer('attempt').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('idempotency_keys_tenant_idx').on(t.tenantId),
    index('idempotency_keys_expires_idx').on(t.expiresAt),
  ],
);

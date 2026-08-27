import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    runId: text('run_id'),
    purpose: text('purpose').$type<'agent' | 'classifier' | 'embedding' | 'judge'>().notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    costUsdMicros: bigint('cost_usd_micros', { mode: 'number' }),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_calls_tenant_idx').on(t.tenantId), index('llm_calls_run_idx').on(t.runId)],
);

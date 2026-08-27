import { desc } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import type { AgentState, Intent, RunOutcome, RunStepKind } from '@kora/core';
import { conversations } from './conversations.js';

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    traceId: text('trace_id').notNull(),
    agentConfigVersion: text('agent_config_version').notNull(),
    /** Set once at run start. In-flight runs finish on the version they began with. */
    agentVersionId: text('agent_version_id'),
    triggerMessageId: text('trigger_message_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    stepCount: integer('step_count').notNull().default(0),
    intent: text('intent').$type<Intent>(),
    intentConfidence: real('intent_confidence'),
    outcome: text('outcome').$type<RunOutcome>(),
    finalState: text('final_state').$type<AgentState>(),
    errorCode: text('error_code'),
    tokenInput: integer('token_input').notNull().default(0),
    tokenOutput: integer('token_output').notNull().default(0),
    costUsdMicros: bigint('cost_usd_micros', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    index('agent_runs_tenant_idx').on(t.tenantId),
    index('agent_runs_conversation_idx').on(t.conversationId, t.startedAt),
    index('agent_runs_trace_idx').on(t.traceId),
    // Covering indexes for the operator screens. Keyset pagination orders by
    // (started_at desc, id desc), so the index has to match that exactly.
    index('agent_runs_tenant_started_idx').on(t.tenantId, desc(t.startedAt), desc(t.id)),
    index('agent_runs_tenant_config_started_idx').on(
      t.tenantId,
      t.agentConfigVersion,
      desc(t.startedAt),
    ),
    index('agent_runs_tenant_intent_started_idx').on(t.tenantId, t.intent, desc(t.startedAt)),
    index('agent_runs_tenant_outcome_started_idx').on(t.tenantId, t.outcome, desc(t.startedAt)),
  ],
);

export const runSteps = pgTable(
  'run_steps',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    kind: text('kind').$type<RunStepKind>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer('duration_ms'),
    status: text('status').notNull().default('running'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('run_steps_tenant_idx').on(t.tenantId),
    index('run_steps_run_ordinal_idx').on(t.runId, t.ordinal),
  ],
);

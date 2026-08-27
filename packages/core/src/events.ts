import { z } from 'zod';

export type EventType =
  | 'conversation.started'
  | 'message.received'
  | 'intent.detected'
  | 'context.retrieved'
  | 'policy.checked'
  | 'tool.requested'
  | 'tool.completed'
  | 'tool.failed'
  | 'action.approved'
  | 'action.rejected'
  | 'approval.expired'
  | 'state.changed'
  | 'agent.escalated'
  | 'conversation.resolved'
  | 'run.finished'
  | 'evaluation.completed'
  | 'document.indexed';

export const EVENT_TYPES: readonly EventType[] = [
  'conversation.started',
  'message.received',
  'intent.detected',
  'context.retrieved',
  'policy.checked',
  'tool.requested',
  'tool.completed',
  'tool.failed',
  'action.approved',
  'action.rejected',
  'approval.expired',
  'state.changed',
  'agent.escalated',
  'conversation.resolved',
  'run.finished',
  'evaluation.completed',
  'document.indexed',
];

/** Every event carries these, whatever else it says. */
const envelope = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  occurredAt: z.date(),
});

const withRun = envelope.extend({
  runId: z.string().min(1),
  conversationId: z.string().min(1),
});

/**
 * One schema per event type. An event whose payload does not parse is rejected at
 * `emit`, before the row is written: a malformed event in the log is worse than a
 * missing one, because the log is what a lost job is replayed from.
 */
export const EVENT_SCHEMAS = {
  'conversation.started': envelope.extend({ conversationId: z.string().min(1) }),
  'message.received': envelope.extend({
    conversationId: z.string().min(1),
    messageId: z.string().min(1),
    role: z.string().min(1),
  }),
  'intent.detected': withRun.extend({
    intent: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  'context.retrieved': withRun.extend({ chunkCount: z.number().int().min(0) }),
  'policy.checked': withRun.extend({
    action: z.string().min(1),
    decision: z.enum(['allow', 'deny', 'require_approval']),
    ruleId: z.string().min(1),
  }),
  'tool.requested': withRun.extend({ toolName: z.string().min(1) }),
  'tool.completed': withRun.extend({
    toolName: z.string().min(1),
    verified: z.boolean().nullable(),
  }),
  'tool.failed': withRun.extend({ toolName: z.string().min(1), errorCode: z.string().min(1) }),
  'action.approved': withRun.extend({
    approvalId: z.string().min(1),
    decidedBy: z.string().min(1),
  }),
  'action.rejected': withRun.extend({
    approvalId: z.string().min(1),
    decidedBy: z.string().min(1),
  }),
  'approval.expired': withRun.extend({ approvalId: z.string().min(1) }),
  'state.changed': withRun.extend({ state: z.string().min(1) }),
  'agent.escalated': withRun.extend({ reason: z.string().min(1) }),
  'conversation.resolved': withRun,
  'run.finished': withRun.extend({
    outcome: z.string().min(1),
    finalState: z.string().min(1),
  }),
  'evaluation.completed': withRun.extend({ verifiedResolution: z.boolean() }),
  'document.indexed': envelope.extend({
    documentId: z.string().min(1),
    version: z.number().int().positive(),
    chunkCount: z.number().int().min(0),
  }),
} as const;

export type EventPayload<T extends EventType = EventType> = z.infer<(typeof EVENT_SCHEMAS)[T]>;

export function parseEventPayload<T extends EventType>(type: T, payload: unknown): EventPayload<T> {
  return EVENT_SCHEMAS[type].parse(payload) as EventPayload<T>;
}

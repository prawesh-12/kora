import { withTenant } from '@kora/db';
import { z } from 'zod';
import { defineTool } from '../registry.js';
import { verifyTicket } from '../verify.js';

export const ticketSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  subscriptionId: z.string().nullable(),
  subject: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
  status: z.enum(['open', 'closed']),
  createdAt: z.string(),
});

/**
 * The idempotency key already identifies this conversation, this tool and this
 * exact input, so reusing it as the row id makes a retry land on the ticket it
 * already filed instead of opening a second one.
 */
export function ticketIdFor(idempotencyKey: string): string {
  return `tkt_${idempotencyKey.replace(/^idm_/, '')}`;
}

export const createTicket = defineTool({
  name: 'create_ticket',
  version: 1,
  description:
    'Use this when the customer needs something a colleague must follow up on, and you want a record of it that survives the conversation.',
  inputSchema: z.object({
    customerId: z.string().min(1),
    subscriptionId: z.string().optional(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(4000),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
  outputSchema: ticketSchema,
  sideEffect: 'write_low',
  requiredPermission: 'tickets:write',
  timeoutMs: 6000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [
    {
      input: {
        customerId: 'cus_014',
        subscriptionId: 'sub_1S',
        subject: 'Refund could not be confirmed',
        body: 'The write was accepted but the read-back did not show it.',
        priority: 'high' as const,
      },
    },
  ],
  async execute(input, ctx) {
    const row = await withTenant(ctx.tenantId).tickets.create({
      id: ticketIdFor(ctx.idempotencyKey),
      conversationId: ctx.conversationId,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId ?? null,
      subject: input.subject,
      body: input.body,
      priority: input.priority,
    });
    return {
      id: row.id,
      customerId: row.customerId,
      subscriptionId: row.subscriptionId,
      subject: row.subject,
      priority: row.priority,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  },
  verify: (input, output, ctx) => verifyTicket(input, output, ctx),
});

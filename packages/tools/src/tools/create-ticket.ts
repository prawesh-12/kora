import { z } from 'zod';
import { acme, ticketSchema } from '../clients/acme.js';
import { defineTool } from '../registry.js';
import { verifyTicket } from '../verify.js';

export const createTicket = defineTool({
  name: 'create_ticket',
  version: 1,
  description:
    'Use this when the customer needs something a colleague must follow up on, and you want a record of it that survives the conversation.',
  inputSchema: z.object({
    customerId: z.string().min(1),
    orderId: z.string().optional(),
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
        orderId: '9832',
        subject: 'Replacement could not be confirmed',
        body: 'The write was accepted but the read-back did not show it.',
        priority: 'high' as const,
      },
    },
  ],
  execute: (input, ctx) =>
    acme.createTicket(
      { ...input, idempotencyKey: ctx.idempotencyKey },
      { signal: ctx.signal, fault: ctx.fault },
    ),
  verify: (input, output, ctx) => verifyTicket(input, output, ctx),
});

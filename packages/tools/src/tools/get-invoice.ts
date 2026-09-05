import { z } from 'zod';
import { billingProvider } from '../billing/provider.js';
import { invoiceRecordSchema } from '../billing/schemas.js';
import { defineTool } from '../registry.js';

export const getInvoice = defineTool({
  name: 'get_invoice',
  version: 1,
  description:
    'Use this when the customer asks about a specific charge and you need what the invoice record really says: its status, what was paid, and which payment it links to.',
  inputSchema: z.object({ invoiceId: z.string().min(1) }),
  outputSchema: invoiceRecordSchema,
  sideEffect: 'read',
  requiredPermission: 'invoices:read',
  timeoutMs: 4000,
  maxRetries: 2,
  idempotent: true,
  inputExamples: [{ input: { invoiceId: 'in_1S' } }],
  execute: (input, _ctx) => billingProvider().getInvoice(input.invoiceId),
});

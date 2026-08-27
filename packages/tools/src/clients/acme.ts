import { ToolError, serverEnv } from '@kora/core';
import { z } from 'zod';

export const orderSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  status: z.enum([
    'placed',
    'confirmed',
    'shipped',
    'delivered',
    'cancelled',
    'replacement_created',
    'refunded',
  ]),
  items: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      category: z.string(),
      quantity: z.number().int(),
      unitAmountMinor: z.number().int(),
    }),
  ),
  totalAmountMinor: z.number().int(),
  currency: z.string(),
  placedAt: z.string(),
  deliveredAt: z.string().nullable(),
  replacementIds: z.array(z.string()),
  refundIds: z.array(z.string()).default([]),
  refundedAmountMinor: z.number().int().default(0),
  cancellationIds: z.array(z.string()).default([]),
});

export const refundSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  reason: z.enum(['damaged', 'missing_item', 'wrong_item', 'not_as_described']),
  status: z.enum(['created', 'processing', 'settled']),
  createdAt: z.string(),
});

export const cancellationSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  reason: z.enum(['customer_request', 'duplicate_order', 'address_problem']),
  status: z.enum(['created', 'processing', 'cancelled']),
  createdAt: z.string(),
});

export const ticketSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  orderId: z.string().nullable(),
  subject: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
  status: z.enum(['open', 'closed']),
  createdAt: z.string(),
});

export const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  orderIds: z.array(z.string()),
});

export const replacementSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  status: z.enum(['created', 'processing']),
  createdAt: z.string(),
  estimatedDeliveryDays: z.number().int(),
});

export type OrderResponse = z.infer<typeof orderSchema>;
export type CustomerResponse = z.infer<typeof customerSchema>;
export type ReplacementResponse = z.infer<typeof replacementSchema>;
export type RefundResponse = z.infer<typeof refundSchema>;
export type CancellationResponse = z.infer<typeof cancellationSchema>;
export type TicketResponse = z.infer<typeof ticketSchema>;

export interface CreateRefundRequest {
  orderId: string;
  amountMinor: number;
  reason: 'damaged' | 'missing_item' | 'wrong_item' | 'not_as_described';
  idempotencyKey: string;
}

export interface CancelOrderRequest {
  orderId: string;
  reason: 'customer_request' | 'duplicate_order' | 'address_problem';
  idempotencyKey: string;
}

export interface CreateTicketRequest {
  customerId: string;
  orderId?: string | undefined;
  subject: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
  idempotencyKey: string;
}

export interface CreateReplacementRequest {
  orderId: string;
  items: Array<{ sku: string; quantity: number }>;
  reason: 'damaged' | 'missing_item' | 'wrong_item';
  idempotencyKey: string;
}

export interface RequestOpts {
  signal: AbortSignal;
  fault?: string | undefined;
}

function toolError(
  message: string,
  code: string,
  retryable: boolean,
  context: Record<string, unknown> = {},
) {
  return new ToolError(message, { code, retryable, context });
}

async function request<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  opts: RequestOpts,
  init: RequestInit = {},
): Promise<z.infer<T>> {
  const env = serverEnv();
  const url = `${env.ACME_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.ACME_API_KEY}`,
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (opts.fault) headers['X-Acme-Fault'] = opts.fault;

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, signal: opts.signal });
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError';
    throw toolError(
      aborted ? `acme request to ${path} timed out` : `acme request to ${path} failed`,
      aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_5XX',
      true,
      { path },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status >= 500) {
      throw toolError(`acme returned ${response.status} for ${path}`, 'UPSTREAM_5XX', true, {
        path,
        status: response.status,
        body,
      });
    }
    throw toolError(`acme returned ${response.status} for ${path}`, 'UPSTREAM_4XX', false, {
      path,
      status: response.status,
      body,
    });
  }

  const json = await response.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw toolError(
      `acme returned a body that does not match the schema for ${path}`,
      'MALFORMED_OUTPUT',
      false,
      {
        path,
        issues: parsed.error.issues,
      },
    );
  }
  return parsed.data;
}

/**
 * Raw access for the few Acme endpoints that are not business tools: health and
 * the scenario admin routes. Everything still goes out from this one module.
 */
export function acmeFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response> {
  const env = serverEnv();
  return fetch(`${env.ACME_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.ACME_API_KEY}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export interface AcmeClient {
  getOrder(id: string, opts: RequestOpts): Promise<OrderResponse>;
  getCustomer(id: string, opts: RequestOpts): Promise<CustomerResponse>;
  createReplacement(req: CreateReplacementRequest, opts: RequestOpts): Promise<ReplacementResponse>;
  getReplacement(id: string, opts: RequestOpts): Promise<ReplacementResponse>;
  listReplacements(orderId: string, opts: RequestOpts): Promise<ReplacementResponse[]>;
  createRefund(req: CreateRefundRequest, opts: RequestOpts): Promise<RefundResponse>;
  getRefund(id: string, opts: RequestOpts): Promise<RefundResponse>;
  listRefunds(orderId: string, opts: RequestOpts): Promise<RefundResponse[]>;
  cancelOrder(req: CancelOrderRequest, opts: RequestOpts): Promise<CancellationResponse>;
  getCancellation(id: string, opts: RequestOpts): Promise<CancellationResponse>;
  listCancellations(orderId: string, opts: RequestOpts): Promise<CancellationResponse[]>;
  createTicket(req: CreateTicketRequest, opts: RequestOpts): Promise<TicketResponse>;
  getTicket(id: string, opts: RequestOpts): Promise<TicketResponse>;
}

export const acme: AcmeClient = {
  getOrder: (id, opts) => request(`/orders/${encodeURIComponent(id)}`, orderSchema, opts),

  getCustomer: (id, opts) => request(`/customers/${encodeURIComponent(id)}`, customerSchema, opts),

  createReplacement: (req, opts) =>
    request('/replacements', replacementSchema, opts, {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  getReplacement: (id, opts) =>
    request(`/replacements/${encodeURIComponent(id)}`, replacementSchema, opts),

  listReplacements: async (orderId, opts) =>
    (
      await request(
        `/replacements?orderId=${encodeURIComponent(orderId)}`,
        z.object({ replacements: z.array(replacementSchema) }),
        opts,
      )
    ).replacements,

  createRefund: (req, opts) =>
    request('/refunds', refundSchema, opts, { method: 'POST', body: JSON.stringify(req) }),

  getRefund: (id, opts) => request(`/refunds/${encodeURIComponent(id)}`, refundSchema, opts),

  listRefunds: async (orderId, opts) =>
    (
      await request(
        `/refunds?orderId=${encodeURIComponent(orderId)}`,
        z.object({ refunds: z.array(refundSchema) }),
        opts,
      )
    ).refunds,

  cancelOrder: (req, opts) =>
    request('/cancellations', cancellationSchema, opts, {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  getCancellation: (id, opts) =>
    request(`/cancellations/${encodeURIComponent(id)}`, cancellationSchema, opts),

  listCancellations: async (orderId, opts) =>
    (
      await request(
        `/cancellations?orderId=${encodeURIComponent(orderId)}`,
        z.object({ cancellations: z.array(cancellationSchema) }),
        opts,
      )
    ).cancellations,

  createTicket: (req, opts) =>
    request('/tickets', ticketSchema, opts, { method: 'POST', body: JSON.stringify(req) }),

  getTicket: (id, opts) => request(`/tickets/${encodeURIComponent(id)}`, ticketSchema, opts),
};

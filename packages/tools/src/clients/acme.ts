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

export interface AcmeClient {
  getOrder(id: string, opts: RequestOpts): Promise<OrderResponse>;
  getCustomer(id: string, opts: RequestOpts): Promise<CustomerResponse>;
  createReplacement(req: CreateReplacementRequest, opts: RequestOpts): Promise<ReplacementResponse>;
  getReplacement(id: string, opts: RequestOpts): Promise<ReplacementResponse>;
  listReplacements(orderId: string, opts: RequestOpts): Promise<ReplacementResponse[]>;
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
};

import { z } from 'zod';

export const orderStatuses = [
  'placed',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
  'replacement_created',
  'refunded',
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export const createReplacementBody = z.object({
  orderId: z.string().min(1),
  items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() })),
  reason: z.enum(['damaged', 'missing_item', 'wrong_item']),
  idempotencyKey: z.string().min(1),
});

export type CreateReplacementBody = z.infer<typeof createReplacementBody>;

export const resetBody = z.object({
  orderIds: z.array(z.string().min(1)).optional(),
});

export interface OrderItemResponse {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitAmountMinor: number;
}

export interface OrderResponse {
  id: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItemResponse[];
  totalAmountMinor: number;
  currency: string;
  placedAt: string;
  deliveredAt: string | null;
  replacementIds: string[];
  /** Everything policy needs about money already returned, from one read. */
  refundIds: string[];
  refundedAmountMinor: number;
  cancellationIds: string[];
}

export interface CustomerResponse {
  id: string;
  name: string;
  email: string;
  orderIds: string[];
}

export interface CreateReplacementResponse {
  id: string;
  orderId: string;
  status: 'created' | 'processing';
  createdAt: string;
  estimatedDeliveryDays: number;
}

export const refundReasons = ['damaged', 'missing_item', 'wrong_item', 'not_as_described'] as const;

export type RefundReason = (typeof refundReasons)[number];

export const createRefundBody = z.object({
  orderId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  reason: z.enum(refundReasons),
  idempotencyKey: z.string().min(1),
});

export type CreateRefundBody = z.infer<typeof createRefundBody>;

export interface RefundResponse {
  id: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  reason: RefundReason;
  status: 'created' | 'processing' | 'settled';
  createdAt: string;
}

export const cancellationReasons = [
  'customer_request',
  'duplicate_order',
  'address_problem',
] as const;

export type CancellationReason = (typeof cancellationReasons)[number];

export const createCancellationBody = z.object({
  orderId: z.string().min(1),
  reason: z.enum(cancellationReasons),
  idempotencyKey: z.string().min(1),
});

export type CreateCancellationBody = z.infer<typeof createCancellationBody>;

export interface CancellationResponse {
  id: string;
  orderId: string;
  reason: CancellationReason;
  status: 'created' | 'processing' | 'cancelled';
  createdAt: string;
}

export const ticketPriorities = ['low', 'normal', 'high'] as const;

export type TicketPriority = (typeof ticketPriorities)[number];

export const createTicketBody = z.object({
  customerId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  priority: z.enum(ticketPriorities),
  idempotencyKey: z.string().min(1),
});

export type CreateTicketBody = z.infer<typeof createTicketBody>;

export interface TicketResponse {
  id: string;
  customerId: string;
  orderId: string | null;
  subject: string;
  priority: TicketPriority;
  status: 'open' | 'closed';
  createdAt: string;
}

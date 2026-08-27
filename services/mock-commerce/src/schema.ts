import { z } from 'zod';

export const orderStatuses = [
  'placed',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
  'replacement_created',
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

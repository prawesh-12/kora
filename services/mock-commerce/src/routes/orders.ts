import { Hono } from 'hono';
import { sql } from '../db.js';
import type { AppEnv } from '../faults.js';
import type { OrderItemResponse, OrderResponse, OrderStatus } from '../schema.js';

export interface OrderRow {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_amount_minor: string;
  currency: string;
  placed_at: Date;
  delivered_at: Date | null;
}

interface ItemRow {
  order_id: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unit_amount_minor: string;
}

export async function findOrderRow(id: string): Promise<OrderRow | undefined> {
  const rows = await sql<OrderRow[]>`select * from acme_orders where id = ${id}`;
  return rows[0];
}

async function toResponses(rows: readonly OrderRow[]): Promise<OrderResponse[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const itemRows = await sql<ItemRow[]>`
    select order_id, sku, name, category, quantity, unit_amount_minor
    from acme_order_items where order_id in ${sql(ids)} order by id`;
  const replacementRows = await sql<{ id: string; order_id: string }[]>`
    select id, order_id from acme_replacements
    where order_id in ${sql(ids)} and hidden = false order by id`;
  const refundRows = await sql<{ id: string; order_id: string; amount_minor: string }[]>`
    select id, order_id, amount_minor from acme_refunds
    where order_id in ${sql(ids)} and hidden = false order by id`;
  const cancellationRows = await sql<{ id: string; order_id: string }[]>`
    select id, order_id from acme_cancellations
    where order_id in ${sql(ids)} and hidden = false order by id`;

  const itemsByOrder = new Map<string, OrderItemResponse[]>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({
      sku: item.sku,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unitAmountMinor: Number(item.unit_amount_minor),
    });
    itemsByOrder.set(item.order_id, list);
  }

  const replacementsByOrder = new Map<string, string[]>();
  for (const rep of replacementRows) {
    const list = replacementsByOrder.get(rep.order_id) ?? [];
    list.push(rep.id);
    replacementsByOrder.set(rep.order_id, list);
  }

  const refundsByOrder = new Map<string, { ids: string[]; totalMinor: number }>();
  for (const refund of refundRows) {
    const entry = refundsByOrder.get(refund.order_id) ?? { ids: [], totalMinor: 0 };
    entry.ids.push(refund.id);
    entry.totalMinor += Number(refund.amount_minor);
    refundsByOrder.set(refund.order_id, entry);
  }

  const cancellationsByOrder = new Map<string, string[]>();
  for (const c of cancellationRows) {
    const list = cancellationsByOrder.get(c.order_id) ?? [];
    list.push(c.id);
    cancellationsByOrder.set(c.order_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    items: itemsByOrder.get(row.id) ?? [],
    totalAmountMinor: Number(row.total_amount_minor),
    currency: row.currency,
    placedAt: row.placed_at.toISOString(),
    deliveredAt: row.delivered_at ? row.delivered_at.toISOString() : null,
    replacementIds: replacementsByOrder.get(row.id) ?? [],
    refundIds: refundsByOrder.get(row.id)?.ids ?? [],
    refundedAmountMinor: refundsByOrder.get(row.id)?.totalMinor ?? 0,
    cancellationIds: cancellationsByOrder.get(row.id) ?? [],
  }));
}

export const ordersRoutes = new Hono<AppEnv>();

ordersRoutes.get('/', async (c) => {
  const customerId = c.req.query('customerId');
  if (!customerId) {
    return c.json({ error: { code: 'MISSING_CUSTOMER_ID' } }, 422);
  }
  const rows = await sql<OrderRow[]>`
    select * from acme_orders where customer_id = ${customerId} order by id`;
  return c.json({ orders: await toResponses(rows) });
});

ordersRoutes.get('/:id', async (c) => {
  const row = await findOrderRow(c.req.param('id'));
  if (!row) return c.json({ error: { code: 'ORDER_NOT_FOUND' } }, 404);
  const [response] = await toResponses([row]);
  return c.json(response);
});

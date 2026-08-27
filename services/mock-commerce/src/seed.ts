import { pathToFileURL } from 'node:url';
import { now } from '@kora/core';
import type { TransactionSql } from 'postgres';
import { sql } from './db.js';
import type { OrderStatus } from './schema.js';

export const CURRENCY = 'INR';
export const ESTIMATED_DELIVERY_DAYS = 5;

export const seedCustomer = {
  id: 'cus_014',
  name: 'Priya Nair',
  email: 'priya@example.com',
  createdDaysAgo: 200,
};

export interface SeedOrder {
  id: string;
  sku: string;
  name: string;
  category: string;
  amountMinor: number;
  status: OrderStatus;
  deliveredDaysAgo: number | null;
  placedDaysAgo?: number;
  replacementId?: string;
  refundId?: string;
}

export const seedOrders: SeedOrder[] = [
  {
    id: '9832',
    sku: 'SKU-CM-01',
    name: 'Coffee machine',
    category: 'appliance',
    amountMinor: 349900,
    status: 'delivered',
    deliveredDaysAgo: 4,
  },
  {
    id: '9833',
    sku: 'SKU-EM-02',
    name: 'Espresso machine',
    category: 'appliance',
    amountMinor: 899900,
    status: 'delivered',
    deliveredDaysAgo: 3,
  },
  {
    id: '9834',
    sku: 'SKU-KT-03',
    name: 'Electric kettle',
    category: 'appliance',
    amountMinor: 219900,
    status: 'delivered',
    deliveredDaysAgo: 12,
  },
  {
    id: '9835',
    sku: 'SKU-GC-04',
    name: 'Gift card',
    category: 'gift_card',
    amountMinor: 100000,
    status: 'delivered',
    deliveredDaysAgo: 2,
  },
  {
    id: '9836',
    sku: 'SKU-BL-05',
    name: 'Blender',
    category: 'appliance',
    amountMinor: 429900,
    status: 'delivered',
    deliveredDaysAgo: 2,
    replacementId: 'REP-0001',
  },
  {
    id: '9837',
    sku: 'SKU-HD-06',
    name: 'Headphones',
    category: 'appliance',
    amountMinor: 249900,
    status: 'placed',
    deliveredDaysAgo: null,
    placedDaysAgo: 1,
  },
  {
    id: '9838',
    sku: 'SKU-MW-07',
    name: 'Microwave',
    category: 'appliance',
    amountMinor: 1299900,
    status: 'confirmed',
    deliveredDaysAgo: null,
    placedDaysAgo: 2,
  },
  {
    id: '9839',
    sku: 'SKU-TS-08',
    name: 'Toaster',
    category: 'appliance',
    amountMinor: 179900,
    status: 'shipped',
    deliveredDaysAgo: null,
    placedDaysAgo: 3,
  },
  {
    id: '9840',
    sku: 'SKU-SP-09',
    name: 'Speaker',
    category: 'appliance',
    amountMinor: 549900,
    status: 'delivered',
    deliveredDaysAgo: 3,
  },
  {
    id: '9841',
    sku: 'SKU-VC-10',
    name: 'Vacuum cleaner',
    category: 'appliance',
    amountMinor: 899900,
    status: 'refunded',
    deliveredDaysAgo: 2,
    refundId: 'REF-0001',
  },
];

const DAYS_FROM_PLACED_TO_DELIVERED = 2;

type Tx = TransactionSql;

function placedDaysAgo(order: SeedOrder): number {
  if (order.deliveredDaysAgo === null) return order.placedDaysAgo ?? 1;
  return order.deliveredDaysAgo + DAYS_FROM_PLACED_TO_DELIVERED;
}

async function insertOrder(tx: Tx, order: SeedOrder, at: Date): Promise<void> {
  const deliveredAt =
    order.deliveredDaysAgo === null
      ? tx`null`
      : tx`${at} - make_interval(days => ${order.deliveredDaysAgo})`;
  await tx`
    insert into acme_orders
      (id, customer_id, status, total_amount_minor, currency, placed_at, delivered_at)
    values (
      ${order.id},
      ${seedCustomer.id},
      ${order.status},
      ${order.amountMinor},
      ${CURRENCY},
      ${at} - make_interval(days => ${placedDaysAgo(order)}),
      ${deliveredAt}
    )`;
  await tx`
    insert into acme_order_items (order_id, sku, name, category, quantity, unit_amount_minor)
    values (${order.id}, ${order.sku}, ${order.name}, ${order.category}, 1, ${order.amountMinor})`;
}

async function insertSeedReplacement(tx: Tx, order: SeedOrder, at: Date): Promise<void> {
  if (!order.replacementId) return;
  await tx`
    insert into acme_replacements
      (id, order_id, reason, status, created_at, estimated_delivery_days, idempotency_key, hidden)
    values (
      ${order.replacementId},
      ${order.id},
      'damaged',
      'created',
      ${at} - make_interval(days => ${(order.deliveredDaysAgo ?? 1) - 1}),
      ${ESTIMATED_DELIVERY_DAYS},
      ${`seed:${order.replacementId}`},
      false
    )`;
}

async function insertSeedRefund(tx: Tx, order: SeedOrder, at: Date): Promise<void> {
  if (!order.refundId) return;
  await tx`
    insert into acme_refunds
      (id, order_id, amount_minor, reason, status, created_at, idempotency_key, hidden)
    values (
      ${order.refundId},
      ${order.id},
      ${order.amountMinor},
      'damaged',
      'settled',
      ${at} - make_interval(days => ${(order.deliveredDaysAgo ?? 1) - 1}),
      ${`seed:${order.refundId}`},
      false
    )`;
}

export async function seed(): Promise<void> {
  const at = now();
  await sql.begin(async (tx) => {
    await tx`
      truncate acme_order_items, acme_replacements, acme_refunds, acme_cancellations,
        acme_tickets, acme_idempotency, acme_request_log, acme_orders, acme_customers
      restart identity cascade`;
    await tx`
      insert into acme_customers (id, name, email, created_at)
      values (
        ${seedCustomer.id},
        ${seedCustomer.name},
        ${seedCustomer.email},
        ${at} - make_interval(days => ${seedCustomer.createdDaysAgo})
      )`;
    for (const order of seedOrders) {
      await insertOrder(tx, order, at);
      await insertSeedReplacement(tx, order, at);
      await insertSeedRefund(tx, order, at);
    }
    await tx`select setval('acme_replacement_seq', 1, true)`;
    await tx`select setval('acme_refund_seq', 1, true)`;
    await tx`select setval('acme_cancellation_seq', 1, false)`;
    await tx`select setval('acme_ticket_seq', 1, false)`;
  });
}

export async function resetOrders(orderIds: string[]): Promise<void> {
  const known = seedOrders.filter((o) => orderIds.includes(o.id));
  if (known.length === 0) return;
  const ids = known.map((o) => o.id);
  const at = now();

  await sql.begin(async (tx) => {
    const keyRows = await tx<{ idempotency_key: string }[]>`
      select idempotency_key from acme_replacements
        where order_id in ${tx(ids)} and idempotency_key is not null
      union
      select idempotency_key from acme_refunds
        where order_id in ${tx(ids)} and idempotency_key is not null
      union
      select idempotency_key from acme_cancellations
        where order_id in ${tx(ids)} and idempotency_key is not null
      union
      select idempotency_key from acme_tickets
        where order_id in ${tx(ids)} and idempotency_key is not null`;
    const keys = keyRows.map((r) => r.idempotency_key);
    const paths = ids.map((id) => `/orders/${id}`);

    await tx`delete from acme_replacements where order_id in ${tx(ids)}`;
    await tx`delete from acme_refunds where order_id in ${tx(ids)}`;
    await tx`delete from acme_cancellations where order_id in ${tx(ids)}`;
    await tx`delete from acme_tickets where order_id in ${tx(ids)}`;
    if (keys.length > 0) await tx`delete from acme_idempotency where key in ${tx(keys)}`;
    await tx`
      delete from acme_request_log
      where path in ${tx(paths)}
         or ${keys.length > 0 ? tx`idempotency_key in ${tx(keys)}` : tx`false`}`;

    for (const order of known) {
      await tx`update acme_orders set status = ${order.status} where id = ${order.id}`;
      await insertSeedReplacement(tx, order, at);
      await insertSeedRefund(tx, order, at);
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await seed();
  await sql.end();
  console.log('acme seed applied');
}

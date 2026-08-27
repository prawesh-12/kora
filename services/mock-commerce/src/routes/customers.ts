import { Hono } from 'hono';
import { sql } from '../db.js';
import type { AppEnv } from '../faults.js';
import type { CustomerResponse } from '../schema.js';

interface CustomerRow {
  id: string;
  name: string;
  email: string;
}

export const customersRoutes = new Hono<AppEnv>();

customersRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const rows = await sql<
    CustomerRow[]
  >`select id, name, email from acme_customers where id = ${id}`;
  const customer = rows[0];
  if (!customer) return c.json({ error: { code: 'CUSTOMER_NOT_FOUND' } }, 404);

  const orderRows = await sql<{ id: string }[]>`
    select id from acme_orders where customer_id = ${id} order by id`;

  const response: CustomerResponse = {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    orderIds: orderRows.map((r) => r.id),
  };
  return c.json(response);
});

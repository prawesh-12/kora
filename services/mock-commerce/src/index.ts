import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { serverEnv } from '@kora/core';
import { Hono, type MiddlewareHandler } from 'hono';
import { closeDb } from './db.js';
import { type AppEnv, faultInjection, faultRate, setFaultRate } from './faults.js';
import { readRequestLog, requestLog } from './request-log.js';
import { cancellationsRoutes } from './routes/cancellations.js';
import { customersRoutes } from './routes/customers.js';
import { ordersRoutes } from './routes/orders.js';
import { refundsRoutes } from './routes/refunds.js';
import { replacementsRoutes } from './routes/replacements.js';
import { ticketsRoutes } from './routes/tickets.js';
import { faultRateBody, resetBody } from './schema.js';
import { resetOrders, seed } from './seed.js';

const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header('authorization') !== `Bearer ${serverEnv().ACME_API_KEY}`) {
    return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
  }
  return next();
};

export const app = new Hono<AppEnv>();

app.use('*', requestLog);
app.get('/health', (c) => c.json({ ok: true }));
app.use('*', auth);
app.use('*', faultInjection);

app.post('/admin/reset', async (c) => {
  let raw: unknown = {};
  try {
    raw = (await c.req.json()) ?? {};
  } catch {
    raw = {};
  }
  const parsed = resetBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { code: 'INVALID_BODY', issues: parsed.error.issues } }, 422);
  }
  const orderIds = parsed.data.orderIds;
  if (!orderIds || orderIds.length === 0) {
    await seed();
    return c.json({ ok: true, scope: 'all' });
  }
  await resetOrders(orderIds);
  return c.json({ ok: true, scope: 'orders', orderIds });
});

app.post('/admin/fault-rate', async (c) => {
  const parsed = faultRateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'INVALID_BODY', issues: parsed.error.issues } }, 422);
  }
  setFaultRate(parsed.data.rate);
  return c.json({ ok: true, rate: faultRate() });
});

app.get('/admin/request-log', async (c) => {
  const path = c.req.query('path');
  const rows = await readRequestLog(path);
  return c.json({
    entries: rows.map((row) => ({
      id: row.id,
      method: row.method,
      path: row.path,
      idempotencyKey: row.idempotency_key,
      fault: row.fault,
      reachedBusinessLogic: row.reached_business_logic,
      createdAt: row.created_at.toISOString(),
    })),
  });
});

app.route('/customers', customersRoutes);
app.route('/orders', ordersRoutes);
app.route('/replacements', replacementsRoutes);
app.route('/refunds', refundsRoutes);
app.route('/cancellations', cancellationsRoutes);
app.route('/tickets', ticketsRoutes);

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND' } }, 404));
app.onError((err, c) =>
  c.json({ error: { code: 'INTERNAL', message: (err as Error).message } }, 500),
);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = serverEnv().ACME_PORT;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`acme mock commerce listening on http://localhost:${info.port}`);
  });
  const shutdown = () => {
    server.close(() => {
      void closeDb().then(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

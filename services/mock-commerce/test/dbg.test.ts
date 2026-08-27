import { afterAll, beforeAll, expect, it } from 'vitest';
import { resetOrder, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;
beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.stop(); });

it('debug', async () => {
  await resetOrder(server, '9832');
  const res = await server.call('/replacements', {
    method: 'POST',
    body: { orderId: '9832', items: [{ sku: 'SKU-CM-01', quantity: 1 }], reason: 'damaged', idempotencyKey: 'dbg-1' },
  });
  const t = await res.text(); expect({ status: res.status, t }).toBe(1);
  expect(true).toBe(true);
});

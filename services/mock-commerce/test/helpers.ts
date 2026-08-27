import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { closeDb } from '../src/db.js';
import { app } from '../src/index.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';

const API_KEY = 'acme-dev-key';

export interface CallOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface TestServer {
  url: string;
  call(path: string, opts?: CallOptions): Promise<Response>;
  stop(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  await migrate();
  await seed();

  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    call(path, opts = {}) {
      const init: RequestInit = {
        method: opts.method ?? 'GET',
        headers: {
          authorization: `Bearer ${API_KEY}`,
          'content-type': 'application/json',
          ...opts.headers,
        },
      };
      if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
      if (opts.signal) init.signal = opts.signal;
      return fetch(`${url}${path}`, init);
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await closeDb();
    },
  };
}

export async function resetOrder(server: TestServer, orderId: string): Promise<void> {
  const res = await server.call('/admin/reset', { method: 'POST', body: { orderIds: [orderId] } });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

export function json(res: Response): Promise<any> {
  return res.json();
}

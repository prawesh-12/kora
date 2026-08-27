import type { MiddlewareHandler } from 'hono';
import { sql } from './db.js';
import type { AppEnv } from './faults.js';

export interface RequestLogRow {
  id: number;
  method: string;
  path: string;
  idempotency_key: string | null;
  fault: string | null;
  reached_business_logic: boolean;
  created_at: Date;
}

export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('reachedBusinessLogic', false);
  c.set('idempotencyKey', null);
  try {
    await next();
  } finally {
    await sql`
      insert into acme_request_log (method, path, idempotency_key, fault, reached_business_logic)
      values (
        ${c.req.method},
        ${c.req.path},
        ${c.get('idempotencyKey')},
        ${c.req.header('x-acme-fault') ?? null},
        ${c.get('reachedBusinessLogic')}
      )`;
  }
};

export async function readRequestLog(path?: string): Promise<RequestLogRow[]> {
  const rows = path
    ? await sql<RequestLogRow[]>`
        select * from acme_request_log where path = ${path} order by id`
    : await sql<RequestLogRow[]>`select * from acme_request_log order by id`;
  return [...rows];
}

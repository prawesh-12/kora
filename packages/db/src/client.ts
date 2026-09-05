import { logger, serverEnv } from '@kora/core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

let sqlClient: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function sql() {
  if (!sqlClient) {
    const env = serverEnv();
    if (!env.DATABASE_APP_URL) {
      logger().warn(
        'DATABASE_APP_URL is not set, so the runtime connects as the database owner and row-level security is not enforced. Application scoping still applies.',
      );
    }
    sqlClient = postgres(env.DATABASE_APP_URL ?? env.DATABASE_URL, {
      max: 10,
      onnotice: () => {},
      // Row-level security reads `kora.tenant_id`; as a connection parameter it
      // covers every query, and an unset connection sees nothing at all. This binds
      // the process to one tenant — several need `withTenantTx`, which overrides it.
      connection: { 'kora.tenant_id': env.KORA_TENANT_ID },
    });
  }
  return sqlClient;
}

export function db() {
  if (!dbInstance) dbInstance = drizzle(sql(), { schema });
  return dbInstance;
}

export type Database = ReturnType<typeof db>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function closeDb(): Promise<void> {
  if (sqlClient) await sqlClient.end();
  sqlClient = null;
  dbInstance = null;
}

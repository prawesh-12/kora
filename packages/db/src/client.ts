import { serverEnv } from '@kora/core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

let sqlClient: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function sql() {
  if (!sqlClient) {
    sqlClient = postgres(serverEnv().DATABASE_URL, { max: 10, onnotice: () => {} });
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

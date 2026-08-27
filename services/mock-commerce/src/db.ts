import { serverEnv } from '@kora/core';
import postgres from 'postgres';

export const sql = postgres(serverEnv().DATABASE_URL, {
  max: 12,
  onnotice: () => {},
});

export function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('expected at least one row');
  return row;
}

export async function closeDb(): Promise<void> {
  await sql.end();
}

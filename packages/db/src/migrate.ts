import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger, serverEnv } from '@kora/core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { closeDb } from './client.js';
import * as schema from './schema/index.js';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

const MIGRATIONS_DIR = join(import.meta.dirname, '../migrations');
const EXTENSIONS_SQL = join(import.meta.dirname, '../extensions.sql');

/**
 * Its own owner connection, not the shared one: `db()` connects as the application
 * role, which is subject to row-level security and deliberately cannot run DDL.
 */
export async function runMigrations(): Promise<void> {
  const owner = postgres(serverEnv().DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // Drizzle does not create extensions, and every vector column depends on one.
    await owner.unsafe(readFileSync(EXTENSIONS_SQL, 'utf8'));
    await migrate(drizzle(owner, { schema }), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await owner.end();
  }
}

if (isMain(import.meta.url)) {
  runMigrations()
    .then(() => logger().info('migrations applied'))
    .catch((e) => {
      logger().error({ err: e }, 'migration failed');
      process.exitCode = 1;
    })
    .finally(closeDb);
}

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
 * Migrations run as the database owner, never as the application role.
 *
 * `db()` prefers `DATABASE_APP_URL` so that runtime queries are subject to
 * row-level security. That role deliberately cannot run DDL, so migrations open
 * their own owner connection here rather than borrowing the shared one.
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

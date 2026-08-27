import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@kora/core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db, sql } from './client.js';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

const MIGRATIONS_DIR = join(import.meta.dirname, '../migrations');
const EXTENSIONS_SQL = join(import.meta.dirname, '../extensions.sql');

export async function runMigrations(): Promise<void> {
  // Drizzle does not create extensions, and every vector column depends on one.
  await sql().unsafe(readFileSync(EXTENSIONS_SQL, 'utf8'));
  await migrate(db(), { migrationsFolder: MIGRATIONS_DIR });
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

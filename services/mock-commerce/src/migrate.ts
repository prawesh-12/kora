import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sql } from './db.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await sql.unsafe(await readFile(join(migrationsDir, file), 'utf8'));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await migrate();
  await sql.end();
  console.log('acme migrations applied');
}

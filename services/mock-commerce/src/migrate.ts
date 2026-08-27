import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sql } from './db.js';

const migrationFile = fileURLToPath(new URL('../migrations/0000_acme.sql', import.meta.url));

export async function migrate(): Promise<void> {
  await sql.unsafe(await readFile(migrationFile, 'utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await migrate();
  await sql.end();
  console.log('acme migrations applied');
}

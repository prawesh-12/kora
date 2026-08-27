import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

const ROOT = join('apps', 'web');
const ADAPTER = join('apps', 'web', 'components', 'charts');
const LIBRARY = '@tanstack/charts';

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

/**
 * TanStack Charts is pre-alpha and its own docs say the API may change between
 * minor releases. One adapter module is what keeps an upgrade to one file
 * instead of eight screens.
 */
export function offendingFiles(root: string): string[] {
  const base = join(root, ROOT);
  const adapter = join(root, ADAPTER);
  const offenders: string[] = [];

  for (const file of sourceFiles(base)) {
    if (file.startsWith(adapter)) continue;
    if (readFileSync(file, 'utf8').includes(LIBRARY)) offenders.push(relative(root, file));
  }

  return offenders.sort();
}

if (isMain(import.meta.url)) {
  const offenders = offendingFiles(process.cwd());

  if (offenders.length > 0) {
    console.error(`${LIBRARY} may only be imported by apps/web/components/charts:`);
    for (const f of offenders) console.error(`  ${f}`);
    console.error(
      '\nRender through LineChart or BarChart from @/components/charts/chart instead. The library is pre-alpha and the adapter is what keeps an upgrade to one file.',
    );
    process.exit(1);
  }

  console.log('check-chart-imports: ok');
}

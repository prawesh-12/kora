import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

const ALLOWED_DIR = join('packages', 'tools', 'src', 'clients');
const ACME_IMPORT = /from\s+['"][^'"]*clients\/acme(\.js)?['"]/;
const ACME_BASE_URL = /ACME_BASE_URL/;

const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'coverage']);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

export function findAcmeViolations(
  root: string,
  roots = ['packages', 'apps', 'services'],
): string[] {
  const violations: string[] = [];
  for (const top of roots) {
    let entries: string[];
    try {
      entries = [...sourceFiles(join(root, top))];
    } catch {
      continue;
    }
    for (const file of entries) {
      const rel = relative(root, file);
      const inClient = rel.startsWith(ALLOWED_DIR + sep);
      const isEnv = rel === join('packages', 'core', 'src', 'env.ts');
      const src = readFileSync(file, 'utf8');
      if (!inClient && ACME_IMPORT.test(src)) {
        violations.push(`${rel} imports the Acme client. Only ${ALLOWED_DIR}/ may.`);
      }
      if (!inClient && !isEnv && ACME_BASE_URL.test(src)) {
        violations.push(`${rel} references ACME_BASE_URL. Only the Acme client and env.ts may.`);
      }
    }
  }
  return violations;
}

if (isMain(import.meta.url)) {
  const violations = findAcmeViolations(process.cwd());
  if (violations.length > 0) {
    console.error('Business API calls must go through the tool pipeline:');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('check-acme-imports: ok');
}

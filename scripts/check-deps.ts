import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

const ALLOWED: Record<string, string[]> = {
  '@kora/core': [],
  '@kora/db': ['@kora/core'],
  '@kora/tools': ['@kora/core', '@kora/db'],
  '@kora/ai': ['@kora/core', '@kora/db', '@kora/tools'],
  '@kora/evaluation': ['@kora/core', '@kora/db', '@kora/tools'],
  '@kora/mock-commerce': ['@kora/core'],
  '@kora/worker': ['@kora/core', '@kora/db', '@kora/tools', '@kora/ai', '@kora/evaluation'],
  web: ['@kora/core', '@kora/db', '@kora/tools', '@kora/ai', '@kora/evaluation'],
};

export interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function checkDeps(manifests: Manifest[]): string[] {
  const violations: string[] = [];
  for (const m of manifests) {
    const allowed = ALLOWED[m.name];
    if (!allowed) {
      violations.push(`unknown workspace package "${m.name}" — add it to the dependency matrix`);
      continue;
    }
    const deps = { ...m.dependencies, ...m.devDependencies };
    for (const dep of Object.keys(deps)) {
      if (!dep.startsWith('@kora/')) continue;
      if (allowed.includes(dep)) continue;
      if (m.name === '@kora/ai' && dep === '@kora/evaluation') {
        violations.push(
          '@kora/ai depends on @kora/evaluation. The evaluator reads traces after the fact; ' +
            'making it a runtime dependency breaks replay.',
        );
        continue;
      }
      violations.push(`${m.name} depends on ${dep}, which the dependency matrix does not allow`);
    }
  }
  return violations;
}

function readManifests(root: string): Manifest[] {
  const out: Manifest[] = [];
  for (const dir of ['apps', 'packages', 'services']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const file = join(base, entry, 'package.json');
      if (existsSync(file)) out.push(JSON.parse(readFileSync(file, 'utf8')));
    }
  }
  return out;
}

if (isMain(import.meta.url)) {
  const violations = checkDeps(readManifests(process.cwd()));
  if (violations.length > 0) {
    console.error('Dependency direction violations:');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('check-deps: ok');
}

import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

// The chokepoint: no billing call happens outside the tool pipeline. Only
// packages/tools may import the Stripe SDK or the provider behind it.
const PIPELINE_DIR = join('packages', 'tools', 'src');
const STRIPE_IMPORT =
  /(?:from\s+['"]|import\s+['"]|import\s*\(\s*['"]|require\s*\(\s*['"])stripe(?:\/[^'"]*)?['"]/;
const BILLING_PROVIDER_IMPORT =
  /from\s+['"][^'"]*billing\/(provider|stripe-provider|types|index)(\.js)?['"]/;

const SKIP = new Set([
  'node_modules',
  '.next',
  'dist',
  '.turbo',
  '.git',
  'coverage',
  'test',
  'e2e',
]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

export function findStripeViolations(
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
      const inPipeline = rel.startsWith(PIPELINE_DIR + sep);
      violations.push(...stripeViolationsIn(rel, readFileSync(file, 'utf8'), inPipeline));
    }
  }
  return violations;
}

function stripeViolationsIn(rel: string, src: string, inPipeline: boolean): string[] {
  if (inPipeline) return [];
  const violations: string[] = [];
  if (STRIPE_IMPORT.test(src)) {
    violations.push(`${rel} imports the stripe package. Only ${PIPELINE_DIR}/ may.`);
  }
  if (BILLING_PROVIDER_IMPORT.test(src)) {
    violations.push(`${rel} imports the billing provider. Only ${PIPELINE_DIR}/ may.`);
  }
  return violations;
}

if (isMain(import.meta.url)) {
  const violations = findStripeViolations(process.cwd());
  if (violations.length > 0) {
    console.error('Billing calls must go through the tool pipeline:');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('check-billing-imports: ok');
}

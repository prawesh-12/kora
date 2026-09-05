import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

const ROUTES_DIR = join('apps', 'web', 'app', 'api');

export interface RouteEntry {
  path: string;
  file: string;
  methods: string[];
  /** True when the handler reaches the database with a caller-supplied id. */
  takesResourceId: boolean;
  guarded: boolean;
}

const PUBLIC_ROUTES = new Set([
  '/api/auth/[...all]',
  // Scoped by an unguessable conversation ULID rather than a session: this is the
  // customer-facing chat, and a customer has no operator account.
  '/api/chat/[conversationId]',
  '/api/conversations',
  // Called by Stripe with no operator session: authenticity comes from the
  // webhook signature check, and the handler only reconciles runs, never money.
  '/api/webhooks/stripe',
]);

function* routeFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* routeFiles(full);
    else if (entry === 'route.ts' || entry === 'route.tsx') yield full;
  }
}

export function buildManifest(root: string): RouteEntry[] {
  const base = join(root, ROUTES_DIR);
  const entries: RouteEntry[] = [];

  for (const file of routeFiles(base)) {
    const rel = relative(root, file);
    const routePath = `/${relative(join(root, 'apps', 'web', 'app'), file)
      .split(sep)
      .slice(0, -1)
      .join('/')}`;
    const source = readFileSync(file, 'utf8');

    entries.push({
      path: routePath,
      file: rel,
      methods: [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map(
        (m) => m[1] as string,
      ),
      takesResourceId: routePath.includes('['),
      guarded: /requireOperator\s*\(/.test(source),
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Every route either requires an operator session or is on the public list with a
 * reason. A new route with neither fails the build, so the failure comes from adding
 * the route rather than from remembering to write a test for it.
 */
export function unguardedRoutes(manifest: RouteEntry[]): RouteEntry[] {
  return manifest.filter((r) => !r.guarded && !PUBLIC_ROUTES.has(r.path));
}

if (isMain(import.meta.url)) {
  const manifest = buildManifest(process.cwd());
  const unguarded = unguardedRoutes(manifest);

  if (unguarded.length > 0) {
    console.error('Routes with no operator check and no entry on the public list:');
    for (const r of unguarded) console.error(`  ${r.path}  (${r.file})`);
    console.error(
      '\nAdd `requireOperator()` to the handler, or add the route to PUBLIC_ROUTES in this file with a comment saying why it is safe without a session.',
    );
    process.exit(1);
  }

  console.log(`isolation-suite: ${manifest.length} routes, ${unguarded.length} unguarded`);
  for (const r of manifest) {
    const how = r.guarded ? 'operator session' : 'public, by design';
    console.log(`  ${r.methods.join(',').padEnd(12)} ${r.path.padEnd(42)} ${how}`);
  }
}

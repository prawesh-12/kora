import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The environment lives at the workspace root, which Next does not look at.
 * Loading it from `next.config.ts` only reaches the config process, not the
 * runtime that serves requests, so it has to happen here.
 *
 * The path is walked up from the working directory rather than derived from
 * `import.meta.url`, which the bundler rewrites.
 */
function findRootEnv(): string | null {
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 5; depth++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const candidate = join(dir, '.env');
      return existsSync(candidate) ? candidate : null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function register(): Promise<void> {
  const path = findRootEnv();
  if (!path) return;
  const { config } = await import('dotenv');
  config({ path, quiet: true });
}

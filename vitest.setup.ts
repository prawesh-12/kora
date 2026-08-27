import { join } from 'node:path';
import { config } from 'dotenv';

config({ path: join(import.meta.dirname, '.env'), quiet: true });

/**
 * Test suites connect as the database owner, not the application role.
 *
 * Row-level security pins a connection to one tenant, and almost every suite
 * creates its own tenant to stay isolated from the others. Running them through
 * the application role would mean every fixture failing on a policy rather than
 * on the thing under test.
 *
 * The RLS layer is not left untested by this: `packages/db/test/isolation.test.ts`
 * opens its own application-role connections and asserts the property directly,
 * with application scoping deliberately switched off.
 */
process.env.DATABASE_APP_URL = undefined;
delete process.env.DATABASE_APP_URL;

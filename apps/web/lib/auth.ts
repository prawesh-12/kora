import { serverEnv } from '@kora/core';
import { db, schema } from '@kora/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

function create() {
  const env = serverEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true },
  });
}

let instance: ReturnType<typeof create> | null = null;

/** Built on first use so that importing this module never needs a live environment. */
export function auth() {
  if (!instance) instance = create();
  return instance;
}

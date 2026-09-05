import { pathToFileURL } from 'node:url';
import { logger, newId, now, serverEnv } from '@kora/core';
import { eq } from 'drizzle-orm';
import { closeDb, db } from './client.js';
import { ensureTenantSettings } from './queries/tenant-settings.js';
import * as s from './schema/index.js';

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

/**
 * Better Auth stores email/password credentials as scrypt in the `account` table,
 * formatted `<salt>:<key>`. We write that hash directly so seeding does not have
 * to boot the whole auth server.
 */
async function scryptHash(password: string): Promise<string> {
  const { randomBytes, scrypt } = await import('node:crypto');
  const salt = randomBytes(16).toString('hex');
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, dk) => (err ? reject(err) : resolve(dk as Buffer)),
    );
  });
  return `${salt}:${key.toString('hex')}`;
}

export async function seed(): Promise<{ tenantId: string; operatorId: string }> {
  const env = serverEnv();
  const conn = db();
  const tenantId = env.KORA_TENANT_ID;

  await conn
    .insert(s.tenants)
    .values({
      id: tenantId,
      name: 'Acme Store',
      deploymentMode: env.KORA_DEPLOYMENT_MODE,
      currency: 'INR',
      createdAt: now(),
    })
    .onConflictDoNothing();

  await ensureTenantSettings(tenantId, conn);

  const email = env.KORA_SEED_OPERATOR_EMAIL;
  const [existing] = await conn.select().from(s.user).where(eq(s.user.email, email));
  if (existing) return { tenantId, operatorId: existing.id };

  const operatorId = newId('usr');
  await conn.transaction(async (tx) => {
    await tx.insert(s.user).values({
      id: operatorId,
      name: 'Acme Operator',
      email,
      emailVerified: true,
      createdAt: now(),
      updatedAt: now(),
    });
    await tx.insert(s.account).values({
      id: newId('usr'),
      accountId: operatorId,
      providerId: 'credential',
      issuer: 'local:credential',
      userId: operatorId,
      password: await scryptHash(env.KORA_SEED_OPERATOR_PASSWORD),
      createdAt: now(),
      updatedAt: now(),
    });
  });

  return { tenantId, operatorId };
}

if (isMain(import.meta.url)) {
  seed()
    .then((r) => logger().info(r, 'seed complete'))
    .catch((e) => {
      logger().error({ err: e }, 'seed failed');
      process.exitCode = 1;
    })
    .finally(closeDb);
}

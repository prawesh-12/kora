import { eq } from 'drizzle-orm';
import { type Database, type Tx, db } from '../client.js';
import * as s from '../schema/index.js';

type Conn = Database | Tx;

export async function getTenantSettings(tenantId: string, conn: Conn = db()) {
  const [row] = await conn
    .select()
    .from(s.tenantSettings)
    .where(eq(s.tenantSettings.tenantId, tenantId));
  return row ?? null;
}

export async function ensureTenantSettings(tenantId: string, conn: Conn = db()) {
  const [row] = await conn
    .insert(s.tenantSettings)
    .values({ tenantId })
    .onConflictDoUpdate({
      target: s.tenantSettings.tenantId,
      set: { updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function setStripeSecretEncrypted(
  tenantId: string,
  encrypted: string,
  conn: Conn = db(),
) {
  const [row] = await conn
    .insert(s.tenantSettings)
    .values({ tenantId, stripeSecretEncrypted: encrypted })
    .onConflictDoUpdate({
      target: s.tenantSettings.tenantId,
      set: { stripeSecretEncrypted: encrypted, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function getStripeSecretEncrypted(
  tenantId: string,
  conn: Conn = db(),
): Promise<string | null> {
  const row = await getTenantSettings(tenantId, conn);
  return row?.stripeSecretEncrypted ?? null;
}

export async function saveStripeFixtures(
  tenantId: string,
  manifest: Record<string, unknown>,
  conn: Conn = db(),
) {
  const [row] = await conn
    .insert(s.tenantSettings)
    .values({ tenantId, stripeFixtures: manifest })
    .onConflictDoUpdate({
      target: s.tenantSettings.tenantId,
      set: { stripeFixtures: manifest, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function getStripeFixtures(
  tenantId: string,
  conn: Conn = db(),
): Promise<Record<string, unknown> | null> {
  const row = await getTenantSettings(tenantId, conn);
  return (row?.stripeFixtures as Record<string, unknown> | null) ?? null;
}

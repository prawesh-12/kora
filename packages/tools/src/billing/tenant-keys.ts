import { ConfigError, decryptSecret, encryptSecret } from '@kora/core';
import {
  type Database,
  type Tx,
  db,
  getStripeSecretEncrypted,
  setStripeSecretEncrypted,
} from '@kora/db';

type Conn = Database | Tx;

export async function setTenantStripeKey(
  tenantId: string,
  plainKey: string,
  conn: Conn = db(),
): Promise<{ tenantId: string }> {
  if (!plainKey || plainKey.trim().length === 0) {
    throw new ConfigError('a Stripe key value is required', { code: 'INVALID_KEY' });
  }
  await setStripeSecretEncrypted(tenantId, encryptSecret(plainKey.trim()), conn);
  return { tenantId };
}

export async function getTenantStripeKey(
  tenantId: string,
  conn: Conn = db(),
): Promise<string | null> {
  const encrypted = await getStripeSecretEncrypted(tenantId, conn);
  if (!encrypted) return null;
  return decryptSecret(encrypted);
}

export async function hasTenantStripeKey(tenantId: string, conn: Conn = db()): Promise<boolean> {
  return (await getStripeSecretEncrypted(tenantId, conn)) !== null;
}

export async function requireTenantStripeKey(tenantId: string, conn: Conn = db()): Promise<string> {
  const key = await getTenantStripeKey(tenantId, conn);
  if (!key) {
    throw new ConfigError(`tenant ${tenantId} has no Stripe key configured`, {
      code: 'CONFIG_ERROR',
    });
  }
  return key;
}

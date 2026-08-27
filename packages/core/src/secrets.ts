import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { ConfigError } from './errors.js';
import { serverEnv } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const SALT_BYTES = 16;

/**
 * Business API credentials at rest.
 *
 * The key is derived per secret from a random salt, so two secrets with the same
 * plaintext do not produce the same ciphertext. Rotating `KORA_SECRET_KEY`
 * re-encrypts on next write rather than needing a redeploy.
 *
 * Format: `v1.<salt>.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix
 * is what makes a future algorithm change possible without guessing.
 */
function keyFor(salt: Buffer): Buffer {
  const secret = serverEnv().KORA_SECRET_KEY;
  if (!secret) {
    throw new ConfigError('KORA_SECRET_KEY is not set, so secrets cannot be encrypted', {
      code: 'MISSING_SECRET_KEY',
    });
  }
  return scryptSync(secret, salt, 32);
}

export function encryptSecret(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFor(salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [
    'v1',
    salt.toString('base64url'),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(cipherText: string): string {
  const [version, salt, iv, tag, payload] = cipherText.split('.');
  if (version !== 'v1' || !salt || !iv || !tag || !payload) {
    throw new ConfigError('secret is not in the expected format', { code: 'MALFORMED_SECRET' });
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    keyFor(Buffer.from(salt, 'base64url')),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(payload, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Never log a secret. This is what goes in the log line instead. */
export function redactSecret(cipherText: string): string {
  return `${cipherText.slice(0, 11)}…`;
}

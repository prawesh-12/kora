import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.js';
import { decryptSecret, encryptSecret, redactSecret } from '../src/secrets.js';

describe('secrets at rest', () => {
  it('round-trips a credential', () => {
    const plain = 'acme_live_sk_9f3a2b';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('never produces the same ciphertext twice for the same plaintext', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    const cipher = encryptSecret('acme_live_sk_9f3a2b');
    const parts = cipher.split('.');
    const tampered = [...parts.slice(0, 4), `${parts[4]?.slice(0, -2)}AA`].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('refuses a swapped auth tag', () => {
    const a = encryptSecret('one').split('.');
    const b = encryptSecret('two').split('.');
    expect(() => decryptSecret([...a.slice(0, 3), b[3], a[4]].join('.'))).toThrow();
  });

  it('rejects a malformed secret with a clear error', () => {
    expect(() => decryptSecret('not-a-secret')).toThrow(ConfigError);
    expect(() => decryptSecret('v2.a.b.c.d')).toThrow(/expected format/);
  });

  it('carries a version prefix so the algorithm can change later', () => {
    expect(encryptSecret('x').startsWith('v1.')).toBe(true);
  });

  it('redacts to something short enough to log', () => {
    const redacted = redactSecret(encryptSecret('acme_live_sk_9f3a2b'));
    expect(redacted).toContain('v1.');
    expect(redacted.length).toBeLessThan(20);
    expect(redacted).not.toContain('acme_live');
  });
});

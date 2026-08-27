import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '../src/env.js';
import { ConfigError } from '../src/errors.js';

const base = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };

describe('parseServerEnv', () => {
  it('accepts a minimal environment and fills defaults', () => {
    const env = parseServerEnv(base);
    expect(env.KORA_MAX_STEPS).toBe(8);
    expect(env.KORA_DEPLOYMENT_MODE).toBe('human_approval');
  });

  it('lists every missing variable at once, not just the first', () => {
    try {
      parseServerEnv({});
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('REDIS_URL');
    }
  });

  it('rejects an out-of-range confidence threshold', () => {
    expect(() => parseServerEnv({ ...base, KORA_CONFIDENCE_THRESHOLD: '2' })).toThrow(ConfigError);
  });
});

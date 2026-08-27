import { describe, expect, it } from 'vitest';
import { isId, newId } from '../src/ids.js';

describe('newId', () => {
  it('produces 10,000 unique, sortable ids', () => {
    const ids = Array.from({ length: 10_000 }, () => newId('run'));
    expect(new Set(ids).size).toBe(10_000);
    expect([...ids].sort()).toEqual(ids);
  });

  it('prefixes the id', () => {
    expect(newId('conv')).toMatch(/^conv_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('recognises its own ids', () => {
    expect(isId('run', newId('run'))).toBe(true);
    expect(isId('run', newId('conv'))).toBe(false);
    expect(isId('run', 'run_')).toBe(false);
  });
});

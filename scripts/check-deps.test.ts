import { describe, expect, it } from 'vitest';
import { checkDeps } from './check-deps.js';

describe('checkDeps', () => {
  it('accepts the real dependency matrix', () => {
    expect(
      checkDeps([
        { name: '@kora/core' },
        { name: '@kora/db', dependencies: { '@kora/core': 'workspace:*' } },
        { name: '@kora/ai', dependencies: { '@kora/tools': 'workspace:*' } },
      ]),
    ).toEqual([]);
  });

  it('rejects ai depending on evaluation and says why', () => {
    const v = checkDeps([
      { name: '@kora/ai', dependencies: { '@kora/evaluation': 'workspace:*' } },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('breaks replay');
  });

  it('rejects an inverted edge', () => {
    const v = checkDeps([{ name: '@kora/core', dependencies: { '@kora/db': 'workspace:*' } }]);
    expect(v[0]).toContain('@kora/core depends on @kora/db');
  });
});

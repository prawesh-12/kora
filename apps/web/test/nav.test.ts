import { describe, expect, it } from 'vitest';
import { NAV, activeNavHref } from '@/components/ops/nav';

/** Exactly one item is highlighted on every route: `startsWith` lights up two,
 *  and exact matching lights up none on a detail page. */
describe('the sidebar active item', () => {
  const routes = [
    ['/ops', '/ops'],
    ['/ops/evaluations', '/ops/evaluations'],
    ['/ops/conversations', '/ops/conversations'],
    ['/ops/conversations/conv_01M11A8JJCDMQFWT3WG8SVPP55', '/ops/conversations'],
    ['/ops/approvals', '/ops/approvals'],
    ['/ops/approvals?status=pending', '/ops/approvals'],
    ['/ops/shadow', '/ops/shadow'],
    ['/ops/versions', '/ops/versions'],
    ['/chat', '/chat'],
    ['/chat/conv_123', '/chat'],
  ] as const;

  for (const [pathname, expected] of routes) {
    it(`highlights ${expected} on ${pathname}`, () => {
      expect(activeNavHref(pathname)).toBe(expected);
    });
  }

  it('highlights exactly one item, never two', () => {
    for (const [pathname] of routes) {
      const active = activeNavHref(pathname);
      const matches = NAV.filter((item) => item.href === active);
      expect(matches, `${pathname} matched ${matches.length} items`).toHaveLength(1);
    }
  });

  it('highlights nothing on a route that is not in the nav', () => {
    expect(activeNavHref('/login')).toBeNull();
  });
});

'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Fade a section up 16px the first time it comes into view. Once, never again,
 * never in reverse, which is why this is not a `view()` timeline.
 *
 * A scroll listener rather than an IntersectionObserver: the observer delivers
 * asynchronously, so a fast scroll or an anchor jump can carry a section past
 * the viewport between two deliveries and the entry that arrives reports it as
 * not intersecting. This reads the position directly and cannot miss.
 *
 * Anything already on screen when the page settles is left exactly as the
 * server rendered it. Arming it would hide content that is already readable.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    el.classList.add('reveal--armed');

    const check = () => {
      if (el.getBoundingClientRect().top > window.innerHeight * 0.88) return;
      el.classList.add('reveal--in');
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };

    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check, { passive: true });
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}

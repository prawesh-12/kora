'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Fade a section up 16px the first time it comes into view. Once, never again,
 * never in reverse, which is why this is an observer and not a view() timeline.
 *
 * Anything already on screen when the page settles is left exactly as the
 * server rendered it: arming it would hide content that is already readable.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    el.classList.add('reveal--armed');
    const reveal = () => {
      el.classList.add('reveal--in');
      io.disconnect();
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) reveal();
    });
    io.observe(el);
    // A section that is never observed as intersecting still has to be readable.
    const bail = window.setTimeout(reveal, 4000);
    return () => {
      window.clearTimeout(bail);
      io.disconnect();
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}

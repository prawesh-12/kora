'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Counts from 0 to `to` once over 600ms. Static text under reduced motion.
 *
 * Formats here rather than taking a formatter: this is a client component, and a
 * function prop cannot cross the boundary from the server components that use it.
 */
export function CountUp({ to }: { to: number }) {
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (at: number) => {
      const progress = Math.min((at - start) / 600, 1);
      setValue(to * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to]);

  return <>{`${value.toFixed(1)}%`}</>;
}

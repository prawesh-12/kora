'use client';

import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * A looping timed reveal of fragments that already exist. It plays like a
 * screen recording without being one: no raster asset, nothing to go stale
 * when a label changes, and it stays sharp at any size.
 *
 * Every beat is a CSS animation with its own delay, so this component owns one
 * timer per cycle and nothing else. No per-frame work, and the fragments stay
 * server-rendered: driving beats from React state would make each one a client
 * component and put its hydration in front of the hero's paint.
 *
 * The reset is a hard cut. Dropping the class, forcing a reflow and putting it
 * back returns every element to its first frame together, which is what makes
 * the loop read as a restart rather than a rewind.
 *
 * Nothing renders around it. There is no play, pause, replay or progress bar,
 * so the whole surface is the recording.
 */
export function Sequence({
  cycle,
  className,
  children,
}: {
  /** Seconds from the first beat to the hard reset. */
  cycle: number;
  className?: string;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = frameRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const play = () => {
      el.classList.remove('seq__frame--run');
      void el.offsetWidth; // restarts every animation under the frame at once
      el.classList.add('seq__frame--run');
      timer = setTimeout(play, cycle * 1000);
    };

    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
      el.classList.remove('seq__frame--run');
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        // No timer ever runs off-screen, and coming back starts a clean cycle.
        if (entry.isIntersecting) {
          if (!timer) play();
        } else {
          stop();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      stop();
      io.disconnect();
    };
  }, [cycle]);

  return (
    <div
      className={['seq', className].filter(Boolean).join(' ')}
      style={{ '--cycle': `${cycle}s` } as CSSProperties}
    >
      <div className="seq__frame" ref={frameRef}>
        {children}
      </div>
    </div>
  );
}

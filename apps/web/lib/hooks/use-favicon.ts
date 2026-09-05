"use client";

import { useCallback, useState } from "react";
import { getFaviconUrl } from "@/lib/favicon";

/**
 * Resolves a site favicon and drops it once it is unusable, so callers can draw
 * their own glyph. `onError` is not enough: an image the browser starts loading
 * from server-rendered HTML usually fails before React attaches a handler, and
 * that event is never replayed. `decode()` settles on the final state instead.
 */
export function useFavicon(url?: string) {
  const resolved = url ? getFaviconUrl(url) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolved && resolved !== failedSrc ? resolved : null;

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !src) return;

      let released = false;
      img.decode().catch(() => {
        if (!released) setFailedSrc(src);
      });

      // A late rejection would describe an image we are no longer showing.
      return () => {
        released = true;
      };
    },
    [src],
  );

  return { src, ref };
}

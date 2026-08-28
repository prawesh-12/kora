import type { CSSProperties } from 'react';

/**
 * A beat's offset from the start of its sequence, as the delay its CSS
 * animation runs against.
 *
 * Deliberately not in `Sequence.tsx`: that file is a client component, and a
 * function exported from one cannot be called while rendering on the server.
 * Keeping it here is what lets every animated fragment stay server-rendered.
 */
export function at(seconds: number): CSSProperties {
  return { '--at': `${seconds}s` } as CSSProperties;
}

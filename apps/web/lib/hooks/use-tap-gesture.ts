"use client";

import { useMemo, useRef } from "react";

export interface TapRecord<S> {
  pointerType: string;
  state: S;
}

export interface TapGesture<S> {
  start: (event: { pointerType: string }, state: S) => void;
  /** Read the record and clear it. `null` when no pointer is behind this click. */
  take: () => TapRecord<S> | null;
  drop: () => void;
}

/**
 * A `click` carries no `pointerType` in the engines that matter, so the
 * preceding `pointerdown` is the only thing that says which input activated a
 * control — or whether one did, since keyboard activation synthesizes a click
 * with no pointer behind it. State is recorded with it because a browser that
 * focuses on contact can open the panel the tap was meant to open, so reading
 * the state at click time would undo it.
 *
 * A record that outlives its gesture would be inherited by a later click, so
 * the surface must wire `drop` to both `onPointerCancel` (a scroll steals the
 * touch and no click ever arrives) and `onKeyDown`.
 */
export function useTapGesture<S>(): TapGesture<S> {
  const record = useRef<TapRecord<S> | null>(null);

  return useMemo(
    () => ({
      start: (event, state) => {
        record.current = { pointerType: event.pointerType, state };
      },
      take: () => {
        const spent = record.current;
        record.current = null;
        return spent;
      },
      drop: () => {
        record.current = null;
      },
    }),
    [],
  );
}

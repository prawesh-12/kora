"use client";

import { useMemo, useRef } from "react";
import { isHoveringPointer } from "@/lib/touch";

interface BoundaryEvent {
  pointerId: number;
  pointerType: string;
  buttons: number;
}

export interface HoverGesture {
  /** True when this enter starts a hover: the pointer arrived resting, not pressing. */
  enter: (event: BoundaryEvent) => boolean;
  /** True when this leave ends a hover that entered as one. */
  leave: (event: BoundaryEvent) => boolean;
}

/**
 * Pairs a surface's enter with its leave, per pointer. Asking `buttons` again
 * at the leave goes wrong both ways: a pen's boundary events are spec'd to
 * come after `pointerup`, so its leave carries `buttons: 0` and reads as a
 * mouse gliding off; a mouse dragged off while pressed leaves with
 * `buttons: 1` and never sends a second leave. So hover is released by
 * whichever pointer took it, and only contact at enter is tracked — an
 * unmatched leave still counts, since the alternative is state with no way out.
 */
export function useHoverGesture(): HoverGesture {
  const contact = useRef(new Set<number>());

  return useMemo(
    () => ({
      enter: (event) => {
        if (isHoveringPointer(event)) {
          contact.current.delete(event.pointerId);
          return true;
        }
        contact.current.add(event.pointerId);
        return false;
      },
      leave: (event) => {
        const arrivedInContact = contact.current.delete(event.pointerId);
        return !arrivedInContact && event.pointerType !== "touch";
      },
    }),
    [],
  );
}

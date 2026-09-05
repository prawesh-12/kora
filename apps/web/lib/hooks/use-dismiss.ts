"use client";

import { type RefObject, useEffect } from "react";

/**
 * `"pass-through"` matches native popover light-dismiss: the tap closes the
 * overlay *and* activates what was under it. `"consume"` swallows that
 * activation, for overlays sitting over costly-to-trigger controls.
 */
export type DismissBehavior = "pass-through" | "consume";

export interface DismissOptions {
  /** Default `"pass-through"`. */
  behavior?: DismissBehavior;
  /** Dismiss on Escape as well. Default true. */
  escape?: boolean;
  /** Return true for an outside target that should *not* dismiss. Must be stable. */
  ignore?: (target: Element) => boolean;
}

/**
 * Overlays have no shared z-order to consult, so each open scope registers what
 * it counts as inside itself; that is how a consumed dismissal recognises a
 * gesture belonging to an overlay in front of it.
 */
const openScopes = new Set<(target: Element) => boolean>();

function claimedByAnotherScope(
  self: (target: Element) => boolean,
  target: Element,
) {
  for (const scope of openScopes) {
    if (scope !== self && scope(target)) return true;
  }
  return false;
}

// preventDefault on pointerdown does not suppress the click that follows, so
// consuming a gesture means swallowing that click itself. The swallower
// deliberately outlives the effect that installed it, and releases on the
// click, the next gesture, or a keydown so it can never eat a later one.
function consumeActivation(source: Event) {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    release();
  };
  const restart = (event: Event) => {
    if (event !== source) release();
  };
  const release = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", restart, true);
    window.removeEventListener("pointercancel", restart, true);
    window.removeEventListener("keydown", release, true);
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", restart, true);
  window.addEventListener("pointercancel", restart, true);
  window.addEventListener("keydown", release, true);
}

/**
 * Close an open overlay on Escape or a pointerdown outside `ref`; pass `null`
 * for `ref` and use `ignore` when inside isn't one element.
 *
 * The pointerdown listener is capture-phase because a bubble-phase one is
 * blinded by any intervening handler that stops propagation. `onDismiss` and
 * `ignore` must be stable so the listeners aren't re-bound every render.
 */
export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  ref: RefObject<HTMLElement | null> | null,
  {
    behavior = "pass-through",
    escape: dismissOnEscape = true,
    ignore,
  }: DismissOptions = {},
) {
  useEffect(() => {
    if (!open) return;
    const inside = (target: Element) =>
      Boolean(ref?.current?.contains(target)) || Boolean(ignore?.(target));
    const onKey = (event: KeyboardEvent) => {
      if (dismissOnEscape && event.key === "Escape") onDismiss();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || inside(target)) return;
      // A gesture inside another open overlay is that overlay's to answer;
      // swallowing its click from behind would cost the user their target.
      if (behavior === "consume" && !claimedByAnotherScope(inside, target)) {
        consumeActivation(event);
      }
      onDismiss();
    };
    openScopes.add(inside);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      openScopes.delete(inside);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, onDismiss, ref, behavior, dismissOnEscape, ignore]);
}

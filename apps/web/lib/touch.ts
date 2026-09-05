export const TOUCH_GESTURE_CLASS = "select-none [-webkit-touch-callout:none]";

/**
 * `pointer: coarse` describes only the *primary* pointer, so hybrid machines
 * read it wrong both ways. That is accepted here because losing a selection is
 * a nuisance; where the miss would cost a gesture, pair it with
 * `holdSelection` on the press instead.
 */
export const TOUCH_GESTURE_CONTENT_CLASS =
  "[-webkit-touch-callout:none] pointer-coarse:select-none";

/**
 * Suppress selection for the duration of a gesture, returning the release.
 * Inline so it wins over the classes above regardless of primary pointer.
 */
export function holdSelection(element: HTMLElement) {
  element.style.setProperty("user-select", "none");
  element.style.setProperty("-webkit-user-select", "none");
  return () => {
    element.style.removeProperty("user-select");
    element.style.removeProperty("-webkit-user-select");
  };
}

/**
 * WebKit throws `NotFoundError` when the pointer is already gone by the time
 * the handler runs, and an uncaught throw would take the rest of the gesture
 * with it. Touch pointers carry implicit capture anyway, so a miss is not fatal.
 */
export function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer already gone.
  }
}

export function releasePointer(element: Element, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Capture was already dropped by the browser.
  }
}

/**
 * Per-event rather than per-device: iPadOS reports a fine hovering pointer for
 * a finger, so no device capability can answer this. `buttons` separates a pen
 * resting on the glass, which is contact rather than hover.
 */
export const isHoveringPointer = (event: {
  pointerType: string;
  buttons: number;
}) => event.pointerType !== "touch" && event.buttons === 0;

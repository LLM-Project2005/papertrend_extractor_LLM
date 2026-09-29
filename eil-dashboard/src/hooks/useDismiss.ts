"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes an open menu or popover when the reader presses anywhere outside it,
 * or presses Escape - the way every menu is expected to behave.
 *
 * `container` must hold both the button that opens the menu and the menu
 * itself: a press on the button is then left to the button's own toggle,
 * rather than closing the menu only for the click to open it again.
 *
 * The press is caught in the capture phase, so a control that stops the
 * event's bubbling still counts as "outside".
 */
export function useDismiss(open: boolean, onDismiss: () => void, container: RefObject<HTMLElement | null>): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && container.current?.contains(target)) return;
      onDismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismissRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [container, open]);
}

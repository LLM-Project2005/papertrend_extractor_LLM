"use client";

import { useEffect, type RefObject } from "react";

/**
 * The height of the chat composer, as a CSS variable on the page, so the
 * analysis tray stands above it instead of over it (docs/32, 2.11, CHAT-8).
 * Zero on every other page: the tray sits in its corner as before.
 */
export const COMPOSER_OFFSET_VAR = "--chat-composer-offset";

export function useComposerOffset(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = ref.current;
    const root = document.documentElement;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => root.style.setProperty(COMPOSER_OFFSET_VAR, `${Math.ceil(node.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(COMPOSER_OFFSET_VAR);
    };
  }, [ref]);
}

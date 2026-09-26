"use client";

import { useEffect, useState } from "react";

/*
 * One underline that slides to the selected tab, instead of each tab drawing
 * its own. Until it has measured, the tabs keep their own underline (see
 * .tabs-sliding in globals.css), so nothing is missing before hydration.
 *
 * The bar is one pixel wide and scaled to the tab's width, so the move is a
 * transform and nothing is laid out again while it slides. It is created with
 * its first position already set, so it appears in place rather than sliding
 * in from the left edge.
 */

interface Box {
  x: number;
  y: number;
  width: number;
}

/** Pass the tab list element (from a callback ref, so a list that mounts late is still measured). */
export function useTabIndicator(nav: HTMLElement | null, activeKey: string): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      setBox(
        active
          ? { x: active.offsetLeft, y: active.offsetTop + active.offsetHeight - 2, width: active.offsetWidth }
          : null
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [nav, activeKey]);

  return box;
}

export function TabIndicator({ box }: { box: Box | null }) {
  if (!box) return null;
  return (
    <span
      aria-hidden="true"
      className="tab-indicator"
      style={{ top: box.y, transform: `translateX(${box.x}px) scaleX(${box.width})` }}
    />
  );
}

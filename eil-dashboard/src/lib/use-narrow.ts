"use client";

import { useEffect, useState } from "react";

/**
 * True on a phone-width screen.
 *
 * Chart label columns are fixed pixel widths, because Recharts sizes axes in
 * pixels. Measured at 390px, a 210-300px theme-name column left the bars about
 * sixty pixels to draw in, so on narrow screens charts take a narrower column
 * and shorter labels (the full name stays in the tooltip). False until mounted,
 * so the server render and the first client render agree.
 */
export function useIsNarrow(maxWidth = 640): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(`(max-width: ${maxWidth - 1}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [maxWidth]);
  return narrow;
}

/** The label column for a horizontal bar chart: wide on a desktop, narrow on a phone. */
export function labelColumn(narrow: boolean, wide: { width: number; chars: number }) {
  return narrow ? { width: 118, chars: 17 } : wide;
}

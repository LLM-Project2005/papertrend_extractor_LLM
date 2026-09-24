/**
 * One source of truth for the colours charts draw themselves in.
 *
 * Before this, four of the five chart components hardcoded `stroke="#94a3b8"`
 * and never read the theme at all, while Overview alone computed its own pair.
 * Two consequences a reader could see:
 *
 *  - Axis labels failed contrast in light mode. Measured on the deployed
 *    dashboard, tick text rendered at rgb(124,138,160) on the page background:
 *    3.35:1, against the 4.5:1 that body-size text needs. The hardcoded
 *    #94a3b8 elsewhere is worse still, about 2.6:1.
 *  - Gridlines and axes kept their light-mode values on a near-black page.
 *
 * The label colour below is the lightest grey that still clears 4.5:1 on each
 * background, so the chart chrome stays quiet without becoming unreadable:
 * slate-500 measures 4.55:1 on the light page, #a3a3a3 measures 8.33:1 on black.
 *
 * An axis *line* is a graphical object rather than text, so it is allowed to sit
 * lower; it is kept lighter than the labels deliberately, so the numbers lead.
 */
export interface ChartTheme {
  /** Tick labels and any other text drawn inside the plot. Meets WCAG AA. */
  label: string;
  /** The axis rule itself. */
  axisLine: string;
  /** Cartesian gridlines. */
  grid: string;
  /** Fill for a single-series bar, where hue would imply a distinction. */
  barFill: string;
  /**
   * The quieter of two series drawn side by side - an earlier period next to a
   * later one. Clears 3:1 against the page, as a chart shape must (4.2-4.8:1).
   */
  barFillMuted: string;
  /** Stroke separating adjacent segments of a donut or stacked bar. */
  segmentEdge: string;
}

export function chartTheme(isDark: boolean): ChartTheme {
  return isDark
    ? {
        label: "#a3a3a3",
        axisLine: "#3f3f46",
        grid: "#242424",
        barFill: "#d4d4d4",
        barFillMuted: "#6b7280",
        segmentEdge: "#1f1f1f",
      }
    : {
        label: "#64748b",
        axisLine: "#cbd5e1",
        grid: "#e2e8f0",
        barFill: "#334155",
        barFillMuted: "#64748b",
        segmentEdge: "#ffffff",
      };
}

/** Recharts takes tick text colour as a `fill`, not as the axis `stroke`. */
export function tickStyle(theme: ChartTheme, fontSize = 12) {
  return { fontSize, fill: theme.label };
}

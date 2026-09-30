/**
 * The tooltip every dashboard chart uses, themed for light and dark. Trends
 * used Recharts' default white box, unreadable in dark mode (docs/32, 2.11,
 * DASH-6).
 */
export function tooltipTheme(isDark: boolean) {
  return isDark
    ? {
        contentStyle: { backgroundColor: "#1f1f1f", border: "1px solid #383838", borderRadius: "16px", color: "#f5f5f5" },
        itemStyle: { color: "#f5f5f5" },
        labelStyle: { color: "#f5f5f5" },
        cursor: { fill: "rgba(255,255,255,0.04)" },
      }
    : {
        contentStyle: { backgroundColor: "#ffffff", border: "1px solid #e8e8e8", borderRadius: "16px", color: "#171717" },
        itemStyle: { color: "#171717" },
        labelStyle: { color: "#171717" },
        cursor: { fill: "rgba(15,23,42,0.04)" },
      };
}

/** More stacked series than this cannot be told apart by colour. */
export const MAX_STACKED_SERIES = 8;

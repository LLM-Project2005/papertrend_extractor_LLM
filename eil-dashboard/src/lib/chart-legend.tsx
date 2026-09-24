import type { ChartTheme } from "@/lib/chart-theme";

/**
 * Legend text in the readable label colour; the swatch beside it keeps the
 * series colour.
 *
 * Recharts draws legend text in each series' own colour by default. Measured on
 * the pilot, palette colours on a white page put legend labels at 2.0-3.9:1 -
 * "Dynamic Assessment" at 2.03:1 - under the 4.5:1 that 11px text needs.
 */
export function legendLabel(theme: ChartTheme, max = 40, rename?: (value: string) => string) {
  return function LegendLabelText(value: unknown) {
    const raw = String(value ?? "");
    const text = rename ? rename(raw) : raw;
    return <span style={{ color: theme.label }}>{text.length > max ? `${text.slice(0, max - 1)}…` : text}</span>;
  };
}

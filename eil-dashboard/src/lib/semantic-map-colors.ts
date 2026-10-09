import { CATEGORICAL_PALETTE, categoricalColor, NEUTRAL_MARK, ordinalColor } from "@/lib/chart-palette";
import type { SemanticMapPoint } from "@/types/semantic-map";

export type ColorMode = "cluster" | "category" | "year" | "track";

/** The neighbourhood colours, shared by the points and the neighbourhood list. */
export const NEIGHBORHOOD_PALETTE: readonly string[] = CATEGORICAL_PALETTE;

/** Up to this many papers, their labels are drawn unless the reader turns them off. */
export const LABELS_BY_DEFAULT_MAX = 40;

/** A point with no category, year or track still gets a colour. */
export const FALLBACK_POINT_COLOR = NEUTRAL_MARK;

export function colorLabelValue(point: Pick<SemanticMapPoint, "categories" | "year" | "track">, mode: ColorMode): string {
  if (mode === "category") return point.categories[0] ?? "No research area";
  if (mode === "year") return point.year || "Unknown";
  return point.track ?? "Unassigned";
}

/**
 * A colour per value in the map, in order. Categories and tracks take the
 * checked categorical palette by position (docs/32, 2.11 DASH-8 and 3.4
 * A11Y-5); years are ordered, so they take a single-hue ramp, earliest
 * lightest, with Unknown grey. Values used to be hashed into eight colours,
 * so two categories or years could share one.
 */
export function colorScale(
  points: Array<Pick<SemanticMapPoint, "categories" | "year" | "track">>,
  mode: ColorMode
): Map<string, string> {
  const values = [...new Set(points.map((point) => colorLabelValue(point, mode)))].sort((left, right) =>
    mode === "year"
      ? (left === "Unknown" ? 1 : 0) - (right === "Unknown" ? 1 : 0) || left.localeCompare(right, undefined, { numeric: true })
      : left.localeCompare(right)
  );
  if (mode === "year") {
    const known = values.filter((value) => value !== "Unknown");
    return new Map(values.map((value) => [value, value === "Unknown" ? NEUTRAL_MARK : ordinalColor(known.indexOf(value), known.length)]));
  }
  return new Map(values.map((value, index) => [value, categoricalColor(index)]));
}

export function pointColor(
  point: Pick<SemanticMapPoint, "clusterId" | "categories" | "year" | "track">,
  mode: ColorMode,
  scale: Map<string, string>
): string {
  if (mode === "cluster") return NEIGHBORHOOD_PALETTE[Math.abs(point.clusterId ?? 0) % NEIGHBORHOOD_PALETTE.length];
  return scale.get(colorLabelValue(point, mode)) ?? FALLBACK_POINT_COLOR;
}

/** Labels are drawn by default only on a map small enough to read them; the reader's choice wins. */
export function showLabelsByDefault(pointCount: number, readerChoice: boolean | null): boolean {
  return readerChoice ?? pointCount <= LABELS_BY_DEFAULT_MAX;
}

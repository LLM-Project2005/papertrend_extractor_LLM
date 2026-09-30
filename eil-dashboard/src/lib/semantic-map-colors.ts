import { TOPIC_PALETTE } from "@/lib/constants";
import type { SemanticMapPoint } from "@/types/semantic-map";

export type ColorMode = "cluster" | "category" | "year" | "track";

/** The neighbourhood colours, shared by the points and the neighbourhood list. */
export const NEIGHBORHOOD_PALETTE = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#4f46e5"];

/** Up to this many papers, their labels are drawn unless the reader turns them off. */
export const LABELS_BY_DEFAULT_MAX = 40;

/** A point with no category, year or track still gets a colour. */
export const FALLBACK_POINT_COLOR = "#94a3b8";

export function colorLabelValue(point: Pick<SemanticMapPoint, "categories" | "year" | "track">, mode: ColorMode): string {
  if (mode === "category") return point.categories[0] ?? "Uncategorized";
  if (mode === "year") return point.year || "Unknown";
  return point.track ?? "Unassigned";
}

/**
 * One colour per value in the map, in order (years chronologically, Unknown
 * last), from the twenty-colour palette (docs/32, 2.11, DASH-8). Values used
 * to be hashed into eight colours, so two categories or years could share one.
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
  return new Map(values.map((value, index) => [value, TOPIC_PALETTE[index % TOPIC_PALETTE.length]]));
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

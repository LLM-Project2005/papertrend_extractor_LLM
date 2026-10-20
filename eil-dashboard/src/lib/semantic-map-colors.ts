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

/**
 * The colouring a map opens with. Neighborhoods, unless the papers did not
 * split into any: then every paper had one colour, and the professor asked why
 * the home page's map has many and this one none (2026-10-20). Such a map
 * opens coloured by research area, or by year when there is one research area.
 */
export function defaultColorMode(map: { clusters: unknown[]; points: Array<Pick<SemanticMapPoint, "categories" | "year">> } | null): ColorMode {
  if (!map || map.clusters.length > 1) return "cluster";
  const distinct = (values: string[]) => new Set(values.filter(Boolean)).size;
  if (distinct(map.points.map((point) => point.categories[0] ?? "")) >= 2) return "category";
  if (distinct(map.points.map((point) => point.year)) >= 2) return "year";
  return "cluster";
}

/** What the map's colours stand for, in a sentence under the legend. */
export function colorMeaning(mode: ColorMode, neighborhoods: number): string {
  if (mode === "category") return "Colour is each paper's research area, from the repository's own profile.";
  if (mode === "year") return "Colour is the publication year; lighter is earlier.";
  if (mode === "track") return "Colour is each paper's track.";
  return neighborhoods > 1
    ? "Colour is a neighborhood: papers the map found close together in meaning, from their text. Lines join papers that share signals."
    : "Colour is a neighborhood, and these papers form one: they are too close in meaning to split into groups. Colour by research area or year to tell them apart.";
}

/** Labels are drawn by default only on a map small enough to read them; the reader's choice wins. */
export function showLabelsByDefault(pointCount: number, readerChoice: boolean | null): boolean {
  return readerChoice ?? pointCount <= LABELS_BY_DEFAULT_MAX;
}

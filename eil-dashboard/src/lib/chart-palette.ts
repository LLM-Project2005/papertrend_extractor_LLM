/**
 * The chart colours (docs/32, 3.4; audit A11Y-5).
 *
 * The old list had twenty colours, nine of them under 3:1 on white and two
 * nearly invisible on the dark page, with red and green side by side. These
 * eight hues each clear 3:1 on the light surfaces (#ffffff, the #fafafa
 * canvas) and on the dark ones (#0a0a0a, #050505, black), and every adjacent
 * pair stays at least 8 ΔE (OKLab x100) apart under simulated colour
 * blindness and 18 ΔE apart for everyone - checked with the dataviz skill's
 * validate_palette.js in both modes. Colours go by position in a sorted list, never by a hash of the name,
 * so two categories cannot land on the same one; a chart that stacks series
 * stops at eight (MAX_STACKED_SERIES).
 */
export const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c08000", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#8a7de6", // violet
  "#e05252", // red
] as const;

/** The colour for the item at this position. Past eight it repeats, so a chart naming more must label them. */
export function categoricalColor(index: number): string {
  const size = CATEGORICAL_PALETTE.length;
  return CATEGORICAL_PALETTE[((Math.trunc(index) % size) + size) % size];
}

/**
 * An ordered blue ramp for ordered values such as years: lighter is earlier.
 * Its ends stay above 2:1 on both surfaces, as an ordinal ramp must.
 */
export const ORDINAL_RAMP = ["#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab"] as const;

/** The ramp colour for position `index` of `count` ordered values. */
export function ordinalColor(index: number, count: number): string {
  if (count <= 1) return ORDINAL_RAMP[2];
  const step = Math.round((index / (count - 1)) * (ORDINAL_RAMP.length - 1));
  return ORDINAL_RAMP[Math.min(ORDINAL_RAMP.length - 1, Math.max(0, step))];
}

/** For a point with no value to colour by. */
export const NEUTRAL_MARK = "#8a8f98";

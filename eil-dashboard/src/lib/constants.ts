/* ────────────────────────────────────────────────────────────────
   Shared constants — track definitions, colour palette, etc.
   ──────────────────────────────────────────────────────────────── */

import { CATEGORICAL_PALETTE } from "@/lib/chart-palette";

export const TRACK_COLS = ["EL", "ELI", "LAE", "Other"] as const;
export type TrackKey = (typeof TRACK_COLS)[number];

export const DEFAULT_REPOSITORY_NAME = "Repository";

/** The legacy slots, from the checked palette (lib/chart-palette.ts): red and green no longer sit together. */
export const TRACK_COLORS: Record<TrackKey, string> = {
  EL: CATEGORICAL_PALETTE[0],
  ELI: CATEGORICAL_PALETTE[1],
  LAE: CATEGORICAL_PALETTE[2],
  Other: CATEGORICAL_PALETTE[6],
};

export const TRACK_NAMES: Record<TrackKey, string> = {
  EL: "Category 1",
  ELI: "Category 2",
  LAE: "Category 3",
  Other: "Other / Unclassified",
};

/** The palette for topic and keyword charts: the checked eight (lib/chart-palette.ts). */
export const TOPIC_PALETTE: readonly string[] = CATEGORICAL_PALETTE;

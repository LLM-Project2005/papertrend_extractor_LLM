/* ────────────────────────────────────────────────────────────────
   Shared constants — track definitions, colour palette, etc.
   ──────────────────────────────────────────────────────────────── */

export const TRACK_COLS = ["EL", "ELI", "LAE", "Other"] as const;
export type TrackKey = (typeof TRACK_COLS)[number];

export const TRACK_COLORS: Record<TrackKey, string> = {
  EL: "#4a7fe5",
  ELI: "#e05c5c",
  LAE: "#3cba83",
  Other: "#9b7fd4",
};

export const TRACK_NAMES: Record<TrackKey, string> = {
  EL: "English Linguistics",
  ELI: "English Language Instruction",
  LAE: "Language Assessment & Evaluation",
  Other: "Other / General",
};

/** 20-colour palette for topic / keyword charts */
export const TOPIC_PALETTE = [
  "#4a7fe5", "#e05c5c", "#3cba83", "#9b7fd4", "#f0a830",
  "#2ec4b6", "#e76f51", "#606c88", "#8ecae6", "#d4a373",
  "#118ab2", "#ef476f", "#06d6a0", "#ffd166", "#073b4c",
  "#b5838d", "#6d6875", "#e9c46a", "#264653", "#a8dadc",
];

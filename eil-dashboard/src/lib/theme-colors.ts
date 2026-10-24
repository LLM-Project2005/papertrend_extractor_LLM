/*
 * One colour per theme, the same in every chart and in the paper window
 * (2026-10-24 review: a theme's colour should mean that theme, and its
 * keywords should wear it too).
 *
 * The sixteen themes with the most papers in the whole repository take a
 * colour each, in that order, and keep it; every other theme is grey and is
 * named by its label. The first eight take the eight chart colours
 * (chart-palette.ts); the next eight take a deeper shade of the same eight
 * hues (the user chose sixteen over eight on 2026-10-24: in testtest it
 * colours a theme in 38 of 41 papers instead of 30). Past eight, colours
 * cannot all be told apart by colour alone, so every chart that shows a theme
 * also names it - a legend, a label or the theme line - and the shades are set
 * per light and dark page, each set checked with the dataviz validator. The
 * ranking is of the whole repository's papers, never of what a filter leaves,
 * so filtering by year or research area does not repaint a theme. Method
 * themes (how a study was done) are not ranked: theme colours are for what
 * papers study.
 *
 * Pure, so it is tested.
 */
import { CATEGORICAL_PALETTE, NEUTRAL_MARK } from "@/lib/chart-palette";
import { subjectRows, themePaperCounts } from "@/lib/dashboard-analytics";
import type { PaperId, TrendRow } from "@/types/database";

/**
 * The sixteen theme colours, for the light and the dark page: the eight chart
 * colours, then the same hues a shade deeper. Each set of sixteen passes the
 * dataviz validator on its own page (lightness band, chroma, normal-vision
 * separation of neighbours, 3:1 against the page).
 */
export const THEME_PALETTE = {
  light: [...CATEGORICAL_PALETTE, "#215ea7", "#a9451e", "#147b57", "#966400", "#a63f65", "#006600", "#6c62b3", "#af4040"],
  dark: [...CATEGORICAL_PALETTE, "#2466b6", "#b84c20", "#15865f", "#a36d00", "#b5456e", "#389e38", "#7569c4", "#be4646"],
} as const;

/** How many themes have a colour of their own. */
export const COLOURED_THEMES = THEME_PALETTE.light.length;

/** Every theme past the sixteenth, and every method theme. */
export const OTHER_THEME_COLOR = NEUTRAL_MARK;

export interface ThemeColors {
  /** Each coloured theme's place among the sixteen colours; a theme not here is grey. */
  byTheme: Record<string, number>;
  /** Papers in each theme across the whole repository. */
  papers: Record<string, number>;
}

export const NO_THEME_COLORS: ThemeColors = { byTheme: {}, papers: {} };

/** The repository's theme colours, from all of its rows (not a filtered view). */
export function themeColorMap(trends: TrendRow[]): ThemeColors {
  const counts = themePaperCounts(subjectRows(trends));
  const byTheme: Record<string, number> = {};
  counts.slice(0, COLOURED_THEMES).forEach((entry, index) => {
    byTheme[entry.topic] = index;
  });
  const papers: Record<string, number> = {};
  for (const entry of themePaperCounts(trends)) papers[entry.topic] = entry.papers;
  return { byTheme, papers };
}

/** A theme's colour on this page: its own, or grey. */
export function themeColor(colors: ThemeColors | null | undefined, theme: string | null | undefined, dark = false): string {
  const name = String(theme ?? "").trim();
  const slot = name ? colors?.byTheme[name] : undefined;
  return slot === undefined ? OTHER_THEME_COLOR : THEME_PALETTE[dark ? "dark" : "light"][slot] ?? OTHER_THEME_COLOR;
}

export function hasThemeColor(colors: ThemeColors | null | undefined, theme: string | null | undefined): boolean {
  const name = String(theme ?? "").trim();
  return Boolean(name) && colors?.byTheme[name] !== undefined;
}

/** The coloured themes in their order, for a legend. */
export function colouredThemes(colors: ThemeColors | null | undefined, dark = false): Array<{ theme: string; color: string }> {
  return Object.entries(colors?.byTheme ?? {})
    .sort((left, right) => left[1] - right[1])
    .map(([theme]) => ({ theme, color: themeColor(colors, theme, dark) }));
}

/**
 * A keyword's theme: the one most of its rows are filed under, ties to the
 * larger theme. Keywords are folded as the keyword counts are ("Learner
 * autonomy" and "learner autonomy" are one).
 */
export function keywordThemes(trends: TrendRow[], colors: ThemeColors): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const row of subjectRows(trends)) {
    const keyword = String(row.keyword ?? "").trim();
    const theme = String(row.topic ?? "").trim();
    if (!keyword || !theme) continue;
    const key = keyword.toLowerCase().replace(/\s+/g, " ");
    const tally = votes.get(key) ?? new Map<string, number>();
    tally.set(theme, (tally.get(theme) ?? 0) + 1);
    votes.set(key, tally);
  }
  const result = new Map<string, string>();
  for (const [key, tally] of votes) {
    const [best] = [...tally.entries()].sort(
      (left, right) => right[1] - left[1] || (colors.papers[right[0]] ?? 0) - (colors.papers[left[0]] ?? 0) || left[0].localeCompare(right[0])
    );
    if (best) result.set(key, best[0]);
  }
  return result;
}

/** The key keywordThemes files a keyword under. */
export function keywordThemeKey(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface PaperTheme {
  theme: string;
  /** Papers in the theme across the repository. */
  papers: number;
  color: string;
  coloured: boolean;
  method: boolean;
}

/**
 * Where one paper's topic labels sit among the repository's themes, keyed by
 * topicKey(label) - the paper window's Topics tab names each topic's theme in
 * its colour.
 */
export function paperThemes(trends: TrendRow[], paperId: PaperId | null | undefined, colors: ThemeColors, dark = false): Map<string, PaperTheme> {
  const result = new Map<string, PaperTheme>();
  if (!paperId) return result;
  for (const row of trends) {
    if (String(row.paper_id) !== String(paperId)) continue;
    const label = String(row.raw_topic ?? row.topic ?? "").trim();
    const theme = String(row.topic ?? "").trim();
    if (!label || !theme) continue;
    const key = topicKey(label);
    if (result.has(key)) continue;
    const method = row.topic_kind === "method";
    result.set(key, {
      theme,
      papers: colors.papers[theme] ?? 1,
      color: method ? OTHER_THEME_COLOR : themeColor(colors, theme, dark),
      coloured: !method && hasThemeColor(colors, theme),
      method,
    });
  }
  return result;
}

/** A topic label as the theme grouping keys it (topic-themes.ts normalizeTopicKey), without importing that module into the page. */
export function topicKey(label: string): string {
  return String(label ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** A colour at an alpha, for a tint behind ink text ("#2a78d6" -> "#2a78d61f"). */
export function tint(color: string, alpha: number): string {
  const hex = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${hex}` : color;
}

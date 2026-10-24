/*
 * One colour per theme, the same in every chart and in the paper window
 * (2026-10-24 review: a theme's colour should mean that theme, and its
 * keywords should wear it too).
 *
 * The eight themes with the most papers in the whole repository take the
 * eight chart colours (chart-palette.ts), in that order, and keep them; every
 * other theme is grey and is named by its label. Eight is where colours stop
 * being told apart - a ninth would only look like one of the eight, so the
 * rest fold into grey rather than cycle (the dataviz rule). The ranking is of
 * the whole repository's papers, never of what a filter leaves, so filtering
 * by year or research area does not repaint a theme. Method themes (how a
 * study was done) are not ranked: theme colours are for what papers study.
 *
 * Pure, so it is tested.
 */
import { CATEGORICAL_PALETTE, NEUTRAL_MARK } from "@/lib/chart-palette";
import { subjectRows, themePaperCounts } from "@/lib/dashboard-analytics";
import type { PaperId, TrendRow } from "@/types/database";

/** How many themes have a colour of their own. */
export const COLOURED_THEMES = CATEGORICAL_PALETTE.length;

/** Every theme past the eighth, and every method theme. */
export const OTHER_THEME_COLOR = NEUTRAL_MARK;

export interface ThemeColors {
  /** The coloured themes and their colours; a theme not here is grey. */
  byTheme: Record<string, string>;
  /** Papers in each theme across the whole repository. */
  papers: Record<string, number>;
}

export const NO_THEME_COLORS: ThemeColors = { byTheme: {}, papers: {} };

/** The repository's theme colours, from all of its rows (not a filtered view). */
export function themeColorMap(trends: TrendRow[]): ThemeColors {
  const counts = themePaperCounts(subjectRows(trends));
  const byTheme: Record<string, string> = {};
  counts.slice(0, COLOURED_THEMES).forEach((entry, index) => {
    byTheme[entry.topic] = CATEGORICAL_PALETTE[index];
  });
  const papers: Record<string, number> = {};
  for (const entry of themePaperCounts(trends)) papers[entry.topic] = entry.papers;
  return { byTheme, papers };
}

/** A theme's colour: its own, or grey. */
export function themeColor(colors: ThemeColors | null | undefined, theme: string | null | undefined): string {
  const name = String(theme ?? "").trim();
  return (name && colors?.byTheme[name]) || OTHER_THEME_COLOR;
}

export function hasThemeColor(colors: ThemeColors | null | undefined, theme: string | null | undefined): boolean {
  const name = String(theme ?? "").trim();
  return Boolean(name && colors?.byTheme[name]);
}

/** The coloured themes in their order, for a legend. */
export function colouredThemes(colors: ThemeColors | null | undefined): Array<{ theme: string; color: string }> {
  return Object.entries(colors?.byTheme ?? {}).map(([theme, color]) => ({ theme, color }));
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
export function paperThemes(trends: TrendRow[], paperId: PaperId | null | undefined, colors: ThemeColors): Map<string, PaperTheme> {
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
      color: method ? OTHER_THEME_COLOR : themeColor(colors, theme),
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

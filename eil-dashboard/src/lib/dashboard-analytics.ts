/**
 * The numbers every dashboard view draws from, computed one way.
 *
 * Before this, the Trend tab, the adaptive tab and the adaptive planner each did
 * their own arithmetic, and each made the same three mistakes (docs/28):
 *
 *  - Years were drawn only where there were papers, at equal spacing, so 2017 and
 *    2025 sat side by side and a smooth area interpolated through the empty years
 *    between them - a trend that did not happen.
 *  - "Emerging" and "declining" split the *distinct years* in half, not the
 *    papers, and called any difference a shift. Every declining bar on the test
 *    repository was exactly -1: one paper in an early year and none later.
 *  - Rankings used keyword occurrences, so one paper repeating a term fifteen
 *    times outranked a term five papers used once each.
 *
 * All three now use these functions. Pure, so they are tested directly.
 */
import { isDatedYear } from "@/lib/dated-year";
import type { PaperId, TrendRow } from "@/types/database";

/* --------------------------------------------------------- what is studied */

/**
 * Rows about what was studied. Method themes - mixed-methods design,
 * questionnaires - are real findings about a collection, but ranked with the
 * subjects they head every topic chart while saying nothing about what anyone
 * studied, so topic charts leave them out and they are shown on their own.
 */
export function subjectRows(trends: TrendRow[]): TrendRow[] {
  return trends.filter((row) => row.topic_kind !== "method");
}

export function methodRows(trends: TrendRow[]): TrendRow[] {
  return trends.filter((row) => row.topic_kind === "method");
}

/* ------------------------------------------------------------------ time */

export interface YearAxis {
  /** Every year from the first to the last, whether or not it has papers. */
  years: string[];
  /** The years in that range with no papers at all. */
  empty: string[];
}

/** Time on the axis is time: one slot per year, empty years included. */
export function yearAxis(years: Iterable<string>): YearAxis {
  const present = new Set([...years].filter(isDatedYear));
  const numbers = [...present].map(Number).sort((a, b) => a - b);
  if (numbers.length === 0) return { years: [], empty: [] };
  const all: string[] = [];
  for (let year = numbers[0]; year <= numbers[numbers.length - 1]; year += 1) all.push(String(year));
  return { years: all, empty: all.filter((year) => !present.has(year)) };
}

/** Papers with no readable publication year, reported rather than plotted. */
export function undatedPaperCount(trends: TrendRow[]): number {
  const dated = new Set(trends.filter((row) => isDatedYear(row.year)).map((row) => row.paper_id));
  return new Set(trends.filter((row) => !dated.has(row.paper_id)).map((row) => row.paper_id)).size;
}

/* ---------------------------------------------------------------- counts */

export interface ThemeCount {
  topic: string;
  papers: number;
  paperIds: PaperId[];
}

/** Themes by the number of papers in them - the measure that means something for a field. */
export function themePaperCounts(trends: TrendRow[]): ThemeCount[] {
  const byTheme = new Map<string, Set<PaperId>>();
  for (const row of trends) {
    const topic = String(row.topic ?? "").trim();
    if (!topic) continue;
    byTheme.set(topic, (byTheme.get(topic) ?? new Set<PaperId>()).add(row.paper_id));
  }
  return [...byTheme.entries()]
    .map(([topic, ids]) => ({ topic, papers: ids.size, paperIds: [...ids] }))
    .sort((a, b) => b.papers - a.papers || a.topic.localeCompare(b.topic));
}

export interface KeywordCount {
  keyword: string;
  papers: number;
  occurrences: number;
  paperIds: PaperId[];
}

/**
 * Keywords by how many papers use them, occurrences only breaking ties.
 *
 * Spelling variants are one keyword ("Learner autonomy", "learner autonomy");
 * the most used spelling is shown.
 */
export function keywordPaperCounts(trends: TrendRow[]): KeywordCount[] {
  const byKey = new Map<string, { spellings: Map<string, number>; papers: Set<PaperId>; occurrences: number }>();
  for (const row of trends) {
    const keyword = String(row.keyword ?? "").trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase().replace(/\s+/g, " ");
    const entry = byKey.get(key) ?? { spellings: new Map<string, number>(), papers: new Set<PaperId>(), occurrences: 0 };
    entry.spellings.set(keyword, (entry.spellings.get(keyword) ?? 0) + 1);
    entry.papers.add(row.paper_id);
    entry.occurrences += Math.max(1, Number(row.keyword_frequency) || 1);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .map((entry) => ({
      keyword: [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      papers: entry.papers.size,
      occurrences: entry.occurrences,
      paperIds: [...entry.papers],
    }))
    .sort((a, b) => b.papers - a.papers || b.occurrences - a.occurrences || a.keyword.localeCompare(b.keyword));
}

/** Papers per theme per year over a full axis; a year with none is a real zero. */
export function themePapersByYear(trends: TrendRow[], themes: string[], years: string[]): Array<Record<string, string | number>> {
  const cell = new Map<string, Set<PaperId>>();
  for (const row of trends) {
    if (!isDatedYear(row.year)) continue;
    const key = `${row.topic}\u0001${row.year}`;
    cell.set(key, (cell.get(key) ?? new Set<PaperId>()).add(row.paper_id));
  }
  return years.map((year) => {
    const entry: Record<string, string | number> = { year };
    for (const theme of themes) entry[theme] = cell.get(`${theme}\u0001${year}`)?.size ?? 0;
    return entry;
  });
}

/* ----------------------------------------------------------------- shifts */

/** A theme needs this many papers before any shift is claimed for it. */
export const SHIFT_MIN_PAPERS = 3;
/**
 * And must have at least this many more (or fewer) later papers than the period
 * sizes alone predict. On its own that still lets one paper tip a claim, so a
 * shift must also survive the removal of any one of its papers - see
 * `survivesOneRemoval`.
 */
export const SHIFT_MIN_EXCESS = 1;

export interface ShiftPeriods {
  earlyLabel: string;
  lateLabel: string;
  earlyPapers: number;
  latePapers: number;
}

export interface ThemeShift {
  topic: string;
  early: number;
  late: number;
  /** Share of each period's papers, 0-1. */
  earlyShare: number;
  lateShare: number;
  paperIds: PaperId[];
}

export interface ThemeShifts {
  periods: ShiftPeriods | null;
  emerging: ThemeShift[];
  declining: ThemeShift[];
  /** Themes with enough papers to be judged at all. */
  judged: number;
}

function rangeLabel(first: string, last: string): string {
  return first === last ? first : `${first}–${last}`;
}

/**
 * Which themes are gaining and losing ground, and only where the papers support it.
 *
 * The collection is split at the year that best halves its dated papers - the
 * papers, not the distinct years. Because the halves are rarely equal, a theme
 * is compared with what the period sizes alone predict: with 13 papers before
 * 2022 and 24 after, a theme with 2 then 4 has not grown, it has kept pace. It
 * is emerging (or declining) only with at least SHIFT_MIN_PAPERS papers, at
 * least SHIFT_MIN_EXCESS more (or fewer) later papers than predicted, and a lean
 * that survives removing any one of its papers - so no claim rests on one paper.
 */
export function themeShifts(trends: TrendRow[]): ThemeShifts {
  const yearOf = new Map<PaperId, number>();
  for (const row of trends) if (isDatedYear(row.year) && !yearOf.has(row.paper_id)) yearOf.set(row.paper_id, Number(row.year));
  const years = [...new Set(yearOf.values())].sort((a, b) => a - b);
  if (years.length < 2) return { periods: null, emerging: [], declining: [], judged: 0 };

  let boundary = years[1];
  let bestGap = Infinity;
  for (const candidate of years.slice(1)) {
    let early = 0;
    for (const year of yearOf.values()) if (year < candidate) early += 1;
    const gap = Math.abs(early - (yearOf.size - early));
    if (gap < bestGap) {
      bestGap = gap;
      boundary = candidate;
    }
  }
  const E = [...yearOf.values()].filter((year) => year < boundary).length;
  const L = yearOf.size - E;
  const lastEarly = years.filter((year) => year < boundary).pop()!;
  const periods: ShiftPeriods = {
    earlyLabel: rangeLabel(String(years[0]), String(lastEarly)),
    lateLabel: rangeLabel(String(boundary), String(years[years.length - 1])),
    earlyPapers: E,
    latePapers: L,
  };

  const byTheme = new Map<string, { early: Set<PaperId>; late: Set<PaperId> }>();
  for (const row of trends) {
    const year = yearOf.get(row.paper_id);
    const topic = String(row.topic ?? "").trim();
    if (year === undefined || !topic) continue;
    const entry = byTheme.get(topic) ?? { early: new Set<PaperId>(), late: new Set<PaperId>() };
    (year < boundary ? entry.early : entry.late).add(row.paper_id);
    byTheme.set(topic, entry);
  }

  const emerging: ThemeShift[] = [];
  const declining: ThemeShift[] = [];
  let judged = 0;
  for (const [topic, entry] of byTheme) {
    const e = entry.early.size;
    const l = entry.late.size;
    if (e + l < SHIFT_MIN_PAPERS) continue;
    judged += 1;
    const excess = l - ((e + l) * L) / (E + L);
    // Take away one paper on the side that makes the claim; the lean must hold.
    const survivesOneRemoval = (direction: 1 | -1) =>
      direction === 1
        ? l - 1 - ((e + l - 1) * (L - 1)) / (E + L - 1) > 0
        : l - ((e - 1 + l) * L) / (E - 1 + L) < 0;
    const shift: ThemeShift = {
      topic,
      early: e,
      late: l,
      earlyShare: E === 0 ? 0 : e / E,
      lateShare: L === 0 ? 0 : l / L,
      paperIds: [...new Set([...entry.early, ...entry.late])],
    };
    if (excess >= SHIFT_MIN_EXCESS && survivesOneRemoval(1)) emerging.push(shift);
    else if (excess <= -SHIFT_MIN_EXCESS && survivesOneRemoval(-1)) declining.push(shift);
  }
  const lift = (shift: ThemeShift) => shift.lateShare - shift.earlyShare;
  emerging.sort((a, b) => lift(b) - lift(a) || a.topic.localeCompare(b.topic));
  declining.sort((a, b) => lift(a) - lift(b) || a.topic.localeCompare(b.topic));
  return { periods, emerging, declining, judged };
}

/* ------------------------------------------------------------ duplicates */

export interface LikelyDuplicate {
  /** The copy that looks like a second upload. */
  paperId: PaperId;
  title: string;
  /** The paper it seems to repeat. */
  originalId: PaperId;
  originalTitle: string;
}

const TITLE_STOP_WORDS = new Set(["a", "an", "the", "of", "on", "in", "to", "and", "for", "by", "with", "among", "its", "their"]);

/**
 * Papers whose titles say they are the same study uploaded twice.
 *
 * Six of the 39 papers in the test repository were: the same thesis chapter
 * and article, or one file uploaded twice. The analysis gave each copy its own
 * topics, and every chart counted both - "5 papers" in a theme was three
 * studies. Found by title: the shorter title's content words nearly all appear
 * in the longer one, which allows a subtitle or a leading "The" and on that
 * repository found exactly the six pairs and nothing else. Deleting a copy is
 * the reader's decision, so this only reports them.
 */
export function likelyDuplicatePapers(trends: TrendRow[]): LikelyDuplicate[] {
  const titles = new Map<PaperId, string>();
  for (const row of trends) if (!titles.has(row.paper_id) && row.title) titles.set(row.paper_id, row.title);
  const words = new Map(
    [...titles.entries()].map(([id, title]) => [
      id,
      new Set(title.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((word) => word && !TITLE_STOP_WORDS.has(word))),
    ])
  );
  const ids = [...titles.keys()].sort();
  const found: LikelyDuplicate[] = [];
  const copies = new Set<PaperId>();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (copies.has(ids[j])) continue;
      const a = words.get(ids[i])!;
      const b = words.get(ids[j])!;
      const shorter = Math.min(a.size, b.size);
      if (shorter < 4) continue;
      const shared = [...a].filter((word) => b.has(word)).length;
      if (shared / shorter < 0.8) continue;
      copies.add(ids[j]);
      found.push({ paperId: ids[j], title: titles.get(ids[j])!, originalId: ids[i], originalTitle: titles.get(ids[i])! });
    }
  }
  return found;
}

/* -------------------------------------------------------------- summaries */

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "A, B and C" */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

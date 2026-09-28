/*
 * The small statistics the insights use, each chosen so that a claim holds up
 * on a collection of a few dozen papers.
 */
import { themeShifts, type ThemeShifts } from "@/lib/dashboard-analytics";
import type { PaperId, TrendRow } from "@/types/database";
import type { CorpusPaper } from "@/lib/insights/corpus";

/** No claim rests on fewer papers than this (docs/28). */
export const MIN_PAPERS = 3;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Whole percent, as every insight shows it. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * How many times more often two things occur together than their sizes alone
 * predict. 1 is chance; 2 is twice as often.
 */
export function lift(together: number, a: number, b: number, total: number): number {
  return a > 0 && b > 0 && total > 0 ? (together * total) / (a * b) : 0;
}

/**
 * The same with one shared paper counted as not shared: the association must
 * not rest on a single paper. (Removing the paper altogether can raise the
 * lift, since both sizes shrink with it, so it would be no test at all.)
 */
export function liftWithOneFewer(together: number, a: number, b: number, total: number): number {
  return together > 1 ? lift(together - 1, a, b, total) : 0;
}

/**
 * Shifts for any per-paper label (a category, a method, a kind of study), by
 * the rules the Trend tab uses for themes: the collection split where it best
 * halves its dated papers, at least three papers, and a lean that survives
 * removing any one of them.
 */
export function labelShifts(papers: CorpusPaper[], labelsOf: (paper: CorpusPaper) => Iterable<string>): ThemeShifts {
  const rows: TrendRow[] = [];
  for (const paper of papers) {
    if (paper.year === null) continue;
    for (const label of labelsOf(paper)) {
      rows.push({ paper_id: paper.id, year: String(paper.year), topic: label, title: paper.title, keyword: "", keyword_frequency: 1, evidence: "" });
    }
  }
  // A dated paper with no label still counts in its period's size.
  for (const paper of papers) {
    if (paper.year === null) continue;
    rows.push({ paper_id: paper.id, year: String(paper.year), topic: "", title: paper.title, keyword: "", keyword_frequency: 1, evidence: "" });
  }
  return themeShifts(rows);
}

/**
 * The expected number of distinct labels among k papers drawn at random from a
 * group (rarefaction). Comparing raw counts would only say that the bigger
 * period has more of everything; this asks how varied the same number of
 * papers is in each.
 */
export function expectedDistinct(labelPaperCounts: number[], groupSize: number, k: number): number {
  if (k <= 0 || groupSize <= 0) return 0;
  const draws = Math.min(k, groupSize);
  let total = 0;
  for (const count of labelPaperCounts) {
    if (count <= 0) continue;
    // Chance that none of the k draws has this label: C(n - c, k) / C(n, k).
    let none = 1;
    for (let index = 0; index < draws; index += 1) {
      const numerator = groupSize - count - index;
      if (numerator <= 0) {
        none = 0;
        break;
      }
      none *= numerator / (groupSize - index);
    }
    total += 1 - none;
  }
  return total;
}

/** Splits dated papers at the year that best halves them, as themeShifts does. */
export function halves(papers: CorpusPaper[]): { early: CorpusPaper[]; late: CorpusPaper[]; earlyLabel: string; lateLabel: string } | null {
  const dated = papers.filter((paper) => paper.year !== null);
  const years = [...new Set(dated.map((paper) => paper.year as number))].sort((a, b) => a - b);
  if (years.length < 2) return null;
  let boundary = years[1];
  let bestGap = Infinity;
  for (const candidate of years.slice(1)) {
    const early = dated.filter((paper) => (paper.year as number) < candidate).length;
    const gap = Math.abs(early - (dated.length - early));
    if (gap < bestGap) {
      bestGap = gap;
      boundary = candidate;
    }
  }
  const early = dated.filter((paper) => (paper.year as number) < boundary);
  const late = dated.filter((paper) => (paper.year as number) >= boundary);
  const label = (list: CorpusPaper[]) => {
    const ys = list.map((paper) => paper.year as number);
    const first = Math.min(...ys);
    const last = Math.max(...ys);
    return first === last ? String(first) : `${first}–${last}`;
  };
  return { early, late, earlyLabel: label(early), lateLabel: label(late) };
}

export function uniqueIds(ids: Iterable<PaperId>): PaperId[] {
  return [...new Set(ids)];
}

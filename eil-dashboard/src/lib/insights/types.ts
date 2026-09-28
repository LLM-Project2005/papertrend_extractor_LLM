/*
 * The Adaptive tab's insights (docs/30).
 *
 * Code works out every candidate insight and its numbers; a model may choose,
 * order and word them, and a checker makes sure any number it writes is one of
 * these facts. The chart a reader sees is drawn from the same insight object
 * the model was shown, so the two cannot disagree.
 */
import type { PaperId } from "@/types/database";

export type InsightFamily = "relationship" | "change" | "composition" | "gap";

/** One checkable number behind an insight. */
export interface InsightFact {
  /** Stable within its insight, e.g. "pair1_together". */
  id: string;
  /** What the number counts, in words a model can quote from. */
  text: string;
  value: number;
  unit: "papers" | "percent" | "ratio" | "count" | "year" | "themes";
}

export interface BarRow {
  label: string;
  value: number;
  /** A second line under the label, e.g. "4 of 9 papers". */
  detail?: string;
  paperIds: PaperId[];
}

export interface CompareRow {
  label: string;
  /** Groups rows under a heading (a category, say). */
  group?: string;
  left: number;
  right: number;
  /** "emerging" / "declining" when the change passes the shift rules. */
  tag?: string;
  paperIds: PaperId[];
}

export interface LifecycleRow {
  label: string;
  status: "new" | "enduring" | "fading" | "burst";
  first: string;
  last: string;
  papers: number;
  /** Papers per year over the chart's axis, for a small sparkline. */
  series: number[];
  paperIds: PaperId[];
}

export interface ListRow {
  title: string;
  detail: string;
  paperIds: PaperId[];
}

export type InsightChart =
  | { kind: "bars"; valueLabel: string; unit: "papers" | "percent" | "themes"; rows: BarRow[] }
  | { kind: "pairs"; rows: Array<{ a: string; b: string; together: number; lift: number; aPapers: number; bPapers: number; paperIds: PaperId[] }> }
  | {
      kind: "matrix";
      rowLabel: string;
      colLabel: string;
      rows: string[];
      cols: string[];
      values: number[][];
      /** Cells a fact talks about: [row, col, "strong" | "absent"]. */
      marks: Array<[number, number, "strong" | "absent"]>;
      paperIds: PaperId[][][];
    }
  | { kind: "compare"; leftLabel: string; rightLabel: string; unit: "percent"; rows: CompareRow[] }
  | { kind: "lifecycles"; years: string[]; rows: LifecycleRow[] }
  | { kind: "list"; rows: ListRow[] };

/** What a fixed tab already draws, so an insight can be checked against it. */
export interface ViewSignature {
  measure: string;
  rows: string;
  cols?: string;
}

export interface Insight {
  /** Stable id, e.g. "theme_pairs"; also the key a model cites. */
  id: string;
  family: InsightFamily;
  /** The question it answers, used as the title when no model writes one. */
  question: string;
  view: ViewSignature;
  chart: InsightChart;
  facts: InsightFact[];
  /** A computed sentence from the facts; shown when no model writes one. */
  takeaway: string;
  /** How much to trust and how interesting: 0-1, higher first. */
  score: number;
  /** Papers the insight rests on. */
  paperIds: PaperId[];
  /** "Based on …" line under the chart. */
  basis: string;
}

export interface InsightNotice {
  id: "duplicates" | "undated" | "few_papers" | "uncertain_years" | "no_insights";
  text: string;
}

export interface InsightCorpusSummary {
  papers: number;
  datedPapers: number;
  firstYear: string | null;
  lastYear: string | null;
  sharedThemes: number;
  duplicatesCountedOnce: number;
}

export interface InsightReport {
  summary: InsightCorpusSummary;
  insights: Insight[];
  notices: InsightNotice[];
}

/** What the model returns once checked, or what code writes without one. */
export interface InsightPlanCard {
  insightId: string;
  title: string;
  takeaway: string;
}

export interface InsightPlan {
  headline: string;
  summary: string;
  cards: InsightPlanCard[];
  caveats: string[];
  source: "model" | "computed";
  model?: string;
  generatedAt: string;
  /** Takeaways the checker replaced because a number did not match a fact. */
  corrected?: number;
}

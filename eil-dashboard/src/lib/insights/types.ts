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
  /** Shares, in whole percent: of the left group's papers, of the right group's. */
  left: number;
  right: number;
  /** The counts behind the shares and the groups' sizes, so a chart can show either (docs/38). */
  leftCount?: number;
  rightCount?: number;
  leftOf?: number;
  rightOf?: number;
  /** "emerging" / "declining" when the change passes the shift rules. */
  tag?: string;
  /** The value the question asked about: drawn first and named in bold. */
  asked?: boolean;
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
  /** Names the detail mentions (two themes), so digits in them are not read as numbers. */
  names?: string[];
}

export interface TableColumnSpec {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface TableRowSpec {
  key: string;
  cells: Record<string, string | number | string[] | null>;
  /** The papers the row is about; one paper makes its first cell open it. */
  paperIds: PaperId[];
}

export type InsightChart =
  | {
      kind: "bars";
      valueLabel: string;
      unit: "papers" | "percent" | "themes";
      rows: BarRow[];
      /** Rows that are years, drawn as columns along the axis. */
      layout?: "columns";
      /** Labels of the rows a question asks about, drawn in the accent. */
      emphasis?: string[];
    }
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
      /** Papers with each row's value, whatever the columns. */
      rowTotals?: number[];
    }
  /** "time": the left value came before the right; "contrast": two groups side by side. */
  | { kind: "compare"; leftLabel: string; rightLabel: string; unit: "percent"; sequence: "time" | "contrast"; rows: CompareRow[] }
  | { kind: "lifecycles"; years: string[]; rows: LifecycleRow[] }
  | { kind: "list"; rows: ListRow[] }
  /** Papers side by side, or values that are all the same, where bars would say nothing (docs/38). */
  | { kind: "table"; columns: TableColumnSpec[]; rows: TableRowSpec[] }
  /** One value: a one-bar chart drawn as a number. */
  | { kind: "stat"; value: string; label: string; detail?: string };

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
  /** The papers its counts are out of, so a chart can say "of 41" and show shares (docs/38). */
  population?: { papers: number; label: string };
  /** Names its sentence mentions that the chart does not draw, so digits in them ("L2 Writing") are not read as numbers. */
  mentions?: string[];
  /** "Based on …" line under the chart. */
  basis: string;
  /** A limit of this finding a reader should know, shown with it. */
  caution?: string;
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
  /** What was replaced and why, for the server log; not sent to the page. */
  checks?: Array<{ field: string; insightId?: string; reason: string }>;
}

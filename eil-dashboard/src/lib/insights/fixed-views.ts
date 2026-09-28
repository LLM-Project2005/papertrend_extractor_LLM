/*
 * What the fixed dashboard tabs already draw.
 *
 * The Adaptive tab used to choose among seven charts, and every one repeated
 * one of these. An insight declares the view it draws (measure × rows × cols);
 * a test checks that none equals a view listed here, and the model is told
 * what is already shown so it does not describe it again.
 */
import type { ViewSignature } from "@/lib/insights/types";

export interface FixedView extends ViewSignature {
  tab: string;
  chart: string;
}

export const FIXED_VIEWS: FixedView[] = [
  { tab: "Overview", chart: "Papers published per year", measure: "papers", rows: "year" },
  { tab: "Overview", chart: "What this repository studies", measure: "papers", rows: "theme" },
  { tab: "Overview", chart: "Category distribution", measure: "papers", rows: "category" },
  { tab: "Overview", chart: "Category overlap", measure: "papers", rows: "category (multi-label)" },
  { tab: "Overview", chart: "How these studies were done", measure: "papers", rows: "method" },
  { tab: "Trend Analysis", chart: "Themes by year", measure: "papers", rows: "year", cols: "theme" },
  { tab: "Trend Analysis", chart: "Gaining and losing ground", measure: "share early vs late", rows: "theme" },
  { tab: "Category Analysis", chart: "Papers per category per year", measure: "papers", rows: "year", cols: "category" },
  { tab: "Category Analysis", chart: "Category co-occurrence", measure: "papers", rows: "category", cols: "category" },
  { tab: "Category Analysis", chart: "Top topics per category", measure: "papers", rows: "theme", cols: "category" },
  { tab: "Keyword Explorer", chart: "Keywords used by the most papers", measure: "papers", rows: "keyword" },
  { tab: "Keyword Explorer", chart: "Themes across years", measure: "papers", rows: "theme", cols: "year" },
  { tab: "Keyword Explorer", chart: "Theme sizes", measure: "papers", rows: "theme (treemap)" },
  { tab: "Keyword Explorer", chart: "Compare themes over time", measure: "papers", rows: "year", cols: "theme (lines)" },
  { tab: "Semantic Map", chart: "Neighbourhoods of related papers", measure: "similarity", rows: "paper" },
];

export function sameView(a: ViewSignature, b: ViewSignature): boolean {
  return a.measure === b.measure && a.rows === b.rows && (a.cols ?? "") === (b.cols ?? "");
}

/** The fixed charts in one line each, for the model. */
export function fixedViewSummary(): string[] {
  return FIXED_VIEWS.map((view) => `${view.tab}: ${view.chart}`);
}

/*
 * An Adaptive insight's chart as CSV (docs/32, 4.3): the same numbers the
 * chart draws, one table per chart kind.
 */
import type { ChartCsv, CsvCell } from "@/lib/chart-csv";
import type { Insight } from "@/lib/insights/types";

const UNIT: Record<string, string> = { papers: "papers", percent: "%", themes: "themes" };

export function insightCsv(insight: Insight, name: string): ChartCsv {
  const chart = insight.chart;
  let header: string[];
  let rows: CsvCell[][];
  switch (chart.kind) {
    case "bars":
      header = ["Label", `${chart.valueLabel} (${UNIT[chart.unit] ?? chart.unit})`, "Detail"];
      rows = chart.rows.map((row) => [row.label, row.value, row.detail ?? ""]);
      break;
    case "pairs":
      header = ["Theme", "With theme", "Papers with both", "Lift", "Papers with the first", "Papers with the second"];
      rows = chart.rows.map((row) => [row.a, row.b, row.together, row.lift, row.aPapers, row.bPapers]);
      break;
    case "matrix":
      header = [`${chart.rowLabel} / ${chart.colLabel}`, ...chart.cols];
      rows = chart.rows.map((label, index) => [label, ...(chart.values[index] ?? [])]);
      break;
    case "compare":
      header = ["Group", "Label", `${chart.leftLabel} (%)`, `${chart.rightLabel} (%)`, "Change"];
      rows = chart.rows.map((row) => [row.group ?? "", row.label, row.left, row.right, row.tag ?? ""]);
      break;
    case "lifecycles":
      header = ["Theme", "Status", "First year", "Last year", "Papers", ...chart.years];
      rows = chart.rows.map((row) => [row.label, row.status, row.first, row.last, row.papers, ...row.series]);
      break;
    case "list":
      header = ["Title", "Detail", "Papers"];
      rows = chart.rows.map((row) => [row.title, row.detail, row.paperIds.length]);
      break;
  }
  return { name, header, rows };
}

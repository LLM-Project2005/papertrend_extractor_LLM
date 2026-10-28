/*
 * A chart's data as CSV (docs/32, 4.3). RFC 4180 quoting, CRLF rows, and a
 * byte-order mark so a spreadsheet reads Thai titles as UTF-8. A text cell
 * that a spreadsheet would run as a formula (=, +, -, @, tab, return) is
 * prefixed with an apostrophe: topic labels and titles come from papers, and a
 * downloaded file should never compute anything when opened.
 */

export type CsvCell = string | number | null | undefined;

export interface ChartCsv {
  /** File name without extension; made safe here. */
  name: string;
  header: string[];
  rows: CsvCell[][];
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "chart-data"}.csv`;
}

/**
 * A chart in a chat answer as CSV. A chart read from the papers is downloaded
 * as its sources - each paper, its value and the paper's own sentence - so the
 * file can be checked and cited, as the card's list can; any other chart as
 * its rows. Chat charts had no download at all, while the dashboard's did
 * (the question bank and competitor review, 2026-10-28).
 */
export function chatChartCsv(chart: {
  title: string;
  yKeys: string[];
  data: Array<Record<string, string | number>>;
  sources?: Array<{ title: string; year: string; value: string; quote: string; note?: string }>;
}): ChartCsv {
  if (chart.sources && chart.sources.length > 0) {
    return {
      name: chart.title,
      header: ["Paper", "Year", "Value", "Note", "Sentence in the paper"],
      rows: chart.sources.map((source) => [source.title, source.year, source.value, source.note ?? "", source.quote]),
    };
  }
  const keys = chart.yKeys.length > 0 ? chart.yKeys : ["value"];
  return {
    name: chart.title,
    header: ["Label", ...keys],
    rows: chart.data.map((row) => [String(row.label ?? ""), ...keys.map((key) => {
      const value = row[key];
      const number = typeof value === "number" ? value : Number(value);
      return value === undefined || value === "" ? "" : Number.isFinite(number) ? number : String(value);
    })]),
  };
}

/**
 * A stacked chart's rows ({ year, [series]: n }) as a table: one row per
 * category on the axis, one column per series, in the order given.
 */
export function seriesTable(
  rows: Array<Record<string, unknown>>,
  axisKey: string,
  series: Array<{ key: string; label: string }>
): { header: string[]; rows: CsvCell[][] } {
  return {
    header: [axisKey === "year" ? "Year" : axisKey, ...series.map((item) => item.label)],
    rows: rows.map((row) => [
      String(row[axisKey] ?? ""),
      ...series.map((item) => {
        const value = row[item.key];
        return typeof value === "number" ? value : 0;
      }),
    ]),
  };
}

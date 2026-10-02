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

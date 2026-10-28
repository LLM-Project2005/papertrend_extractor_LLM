/*
 * The paper table (docs/42): one row per study, one column per thing the
 * reader wants from each, and every cell kept only with the sentence it came
 * from. The competitor review ranked it the largest gap (docs/41): Elicit,
 * SciSpace and NotebookLM all lay papers out against the reader's own columns.
 *
 * This file is what the page and the server share; the reading itself is in
 * paper-table-reading.ts, on the server, and the ready-made columns are in
 * paper-table-presets.ts.
 */
import { z } from "zod";
import type { ChartCsv } from "@/lib/chart-csv";
import type { ColumnPreset } from "@/lib/paper-table-presets";

/** Columns a table can hold, shown or hidden: every ready-made one and some of the reader's own. */
export const MAX_COLUMNS = 64;
/** Rows read for one table; a repository with more is read in its first this many. */
export const MAX_TABLE_PAPERS = 120;
export const MAX_TABLES_PER_REPOSITORY = 30;

export type ColumnKind = "text" | "number" | "category";

export interface TableColumn {
  id: string;
  name: string;
  /** What to read for it, in the reader's words; the name alone when empty. */
  instruction: string;
  kind: ColumnKind;
  /** Hidden from the table and its downloads; its cells are kept, so showing it again reads nothing. */
  hidden?: boolean;
  /** The ready-made column it was added from (paper-table-presets.ts). */
  preset?: string;
}

/**
 * found: the value and the paper's sentence, both checked.
 * not_stated: the paper, as read, does not say.
 * unverified: an answer whose sentence (or number) is not in the paper; never shown as a value.
 * failed: the call that read it failed; read again with the next fill.
 */
export type CellStatus = "found" | "not_stated" | "unverified" | "failed";

export interface TableCell {
  value: string;
  quote: string;
  note: string;
  status: CellStatus;
}

/** Cells by `${paperId}:${columnId}`, so a fill merges into the stored table key by key. */
export type TableCells = Record<string, TableCell>;

export interface TableRow {
  paperId: string;
  runId: string;
  title: string;
  year: string;
}

export function cellKey(paperId: string, columnId: string): string {
  return `${paperId}:${columnId}`;
}

const ColumnSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  instruction: z.string().trim().max(300).default(""),
  kind: z.enum(["text", "number", "category"]).default("text"),
  hidden: z.boolean().optional(),
  preset: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
});

export const ColumnsSchema = z
  .array(ColumnSchema)
  .max(MAX_COLUMNS)
  .refine((columns) => new Set(columns.map((column) => column.id)).size === columns.length, "Each column needs its own id.");

export const TableNameSchema = z.string().trim().min(1).max(120);

/** A new column's id: short, unique in its table, and safe in a cell key. */
export function newColumnId(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "column";
  let id = base;
  for (let suffix = 2; taken.includes(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

export function visibleColumns(columns: TableColumn[]): TableColumn[] {
  return columns.filter((column) => !column.hidden);
}

/** How the column picker names a column: a ready-made one by its preset, the reader's own by its id. */
export function columnChoiceKey(column: Pick<TableColumn, "id" | "preset">): string {
  return column.preset ? `preset:${column.preset}` : `column:${column.id}`;
}

/**
 * The columns after the picker: a column in the table is shown when it is
 * ticked and hidden when it is not (its cells kept), and a ticked ready-made
 * column the table does not have yet is added at the end, to be read.
 */
export function applyColumnChoice(columns: TableColumn[], chosen: Set<string>, presets: ColumnPreset[]): TableColumn[] {
  const next: TableColumn[] = columns.map((column) => {
    const { hidden: _hidden, ...rest } = column;
    return chosen.has(columnChoiceKey(column)) ? rest : { ...rest, hidden: true };
  });
  const have = new Set(columns.map(columnChoiceKey));
  const ids = next.map((column) => column.id);
  for (const preset of presets) {
    const key = `preset:${preset.key}`;
    if (!chosen.has(key) || have.has(key) || next.length >= MAX_COLUMNS) continue;
    const id = newColumnId(preset.key, ids);
    ids.push(id);
    next.push({ id, name: preset.name, instruction: preset.instruction, kind: preset.kind, preset: preset.key });
  }
  return next;
}

/**
 * Columns whose meaning changed, so their cells are read again: a new
 * instruction or kind, or a new name where the name is all there is. A column
 * only renamed, hidden or shown keeps its cells.
 */
export function changedColumns(before: TableColumn[], after: TableColumn[]): string[] {
  const earlier = new Map(before.map((column) => [column.id, column]));
  return after
    .filter((column) => {
      const old = earlier.get(column.id);
      if (!old) return true;
      return old.instruction !== column.instruction || old.kind !== column.kind || (!column.instruction && old.name !== column.name);
    })
    .map((column) => column.id);
}

/** The cells kept when the columns change: a removed or changed column's cells go. */
export function cellsForColumns(cells: TableCells, before: TableColumn[], after: TableColumn[]): TableCells {
  const kept = new Set(after.map((column) => column.id));
  const changed = new Set(changedColumns(before, after));
  return Object.fromEntries(
    Object.entries(cells).filter(([key]) => {
      const columnId = key.slice(key.indexOf(":") + 1);
      return kept.has(columnId) && !changed.has(columnId);
    })
  );
}

/** The cells a fill reads: in the columns shown, those not read yet and those whose call failed. */
export function missingCells(rows: TableRow[], columns: TableColumn[], cells: TableCells): Array<{ paperId: string; columnId: string }> {
  const shown = visibleColumns(columns);
  return rows.flatMap((row) =>
    shown
      .filter((column) => {
        const cell = cells[cellKey(row.paperId, column.id)];
        return !cell || cell.status === "failed";
      })
      .map((column) => ({ paperId: row.paperId, columnId: column.id }))
  );
}

// ---------------------------------------------------------------------------
// The chart above the table.

/** The number a value starts with ("180 students" -> 180, "1,200 texts" -> 1200), or null. */
export function cellNumber(value: string): number | null {
  const match = String(value ?? "").match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export interface TableChartBar {
  label: string;
  value: number;
  /** The tooltip's line: "57 of 72 cells" or the paper's own value. */
  detail: string;
  paperId?: string;
}

export interface TableChartData {
  title: string;
  /** What a bar counts, for the axis and the tooltip. */
  measure: string;
  bars: TableChartBar[];
  /** Figures above the chart; each is computed here. */
  stats: Array<{ label: string; value: string }>;
  note: string;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function shortTitle(title: string, max = 48): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function formatted(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** The charts a table offers: what was found, and each shown number or category column. */
export function chartChoices(columns: TableColumn[]): Array<{ value: string; label: string }> {
  return [
    { value: "found", label: "What was found" },
    ...visibleColumns(columns)
      .filter((column) => column.kind === "number" || column.kind === "category")
      .map((column) => ({ value: column.id, label: column.name })),
  ];
}

/** How many studies each shown column has a value for. */
export function foundChart(rows: TableRow[], columns: TableColumn[], cells: TableCells): TableChartData {
  const shown = visibleColumns(columns);
  const bars = shown.map((column) => {
    const states = { found: 0, not_stated: 0, unverified: 0, unread: 0 };
    for (const row of rows) {
      const cell = cells[cellKey(row.paperId, column.id)];
      if (!cell || cell.status === "failed") states.unread += 1;
      else states[cell.status] += 1;
    }
    const detail = [
      `${states.found} found`,
      states.not_stated ? `${states.not_stated} not stated` : "",
      states.unverified ? `${states.unverified} not confirmed` : "",
      states.unread ? `${states.unread} not read yet` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return { label: column.name, value: states.found, detail };
  });
  const found = bars.reduce((sum, bar) => sum + bar.value, 0);
  const total = rows.length * shown.length;
  return {
    title: "What was found",
    measure: "Studies with a value",
    bars,
    stats: [
      { label: "Studies", value: formatted(rows.length) },
      { label: "Columns shown", value: formatted(shown.length) },
      { label: "Values found", value: total ? `${formatted(found)} of ${formatted(total)}` : "0" },
    ],
    note: "Each bar counts the studies whose paper states the column's value in a sentence that was found in it.",
  };
}

/** A number column: each study's value, largest first, with the total, median and range. */
export function numberChart(rows: TableRow[], column: TableColumn, cells: TableCells): TableChartData {
  const bars: TableChartBar[] = [];
  for (const row of rows) {
    const cell = cells[cellKey(row.paperId, column.id)];
    if (cell?.status !== "found") continue;
    const number = cellNumber(cell.value);
    if (number === null) continue;
    bars.push({ label: shortTitle(row.title), value: number, detail: cell.note ? `${cell.value} (${cell.note})` : cell.value, paperId: row.paperId });
  }
  bars.sort((a, b) => b.value - a.value);
  const values = bars.map((bar) => bar.value).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length === 0 ? 0 : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return {
    title: column.name,
    measure: column.name,
    bars,
    stats: values.length
      ? [
          { label: "Studies reporting it", value: `${formatted(values.length)} of ${formatted(rows.length)}` },
          { label: "Total", value: formatted(values.reduce((sum, value) => sum + value, 0)) },
          { label: "Median", value: formatted(median) },
          { label: "Range", value: `${formatted(values[0])} – ${formatted(values[values.length - 1])}` },
        ]
      : [],
    note: "Each study's own figure, as its sentence gives it. A total adds each study's figure, so anyone in two studies counts twice.",
  };
}

/** Above this many different answers, the rest are counted together as Other. */
const CATEGORY_BARS = 12;

/** A category column: how many studies give each answer; a cell naming two ("Thailand; Vietnam") counts for both. */
export function categoryChart(rows: TableRow[], column: TableColumn, cells: TableCells): TableChartData {
  const counts = new Map<string, { label: string; count: number; spellings: Map<string, number> }>();
  let answered = 0;
  for (const row of rows) {
    const cell = cells[cellKey(row.paperId, column.id)];
    if (cell?.status !== "found") continue;
    answered += 1;
    const names = [...new Set(cell.value.split(/\s*;\s*/).map((part) => part.trim().replace(/[.]+$/, "")).filter(Boolean))];
    for (const name of names) {
      const key = name.toLowerCase();
      const entry = counts.get(key) ?? { label: name, count: 0, spellings: new Map<string, number>() };
      entry.count += 1;
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
      counts.set(key, entry);
    }
  }
  const sorted = [...counts.values()]
    .map((entry) => ({ ...entry, label: [...entry.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const bars: TableChartBar[] = sorted.slice(0, CATEGORY_BARS).map((entry) => ({ label: entry.label, value: entry.count, detail: plural(entry.count, "study", "studies") }));
  const rest = sorted.slice(CATEGORY_BARS);
  if (rest.length > 0) {
    const count = rest.reduce((sum, entry) => sum + entry.count, 0);
    bars.push({ label: `Other (${rest.length})`, value: count, detail: rest.map((entry) => entry.label).slice(0, 8).join(", ") });
  }
  return {
    title: column.name,
    measure: "Studies",
    bars,
    stats: [
      { label: "Studies answering", value: `${formatted(answered)} of ${formatted(rows.length)}` },
      { label: "Different answers", value: formatted(sorted.length) },
    ],
    note: "Answers are counted as the papers word them, with capitals ignored.",
  };
}

export function tableChart(choice: string, rows: TableRow[], columns: TableColumn[], cells: TableCells): TableChartData {
  const column = visibleColumns(columns).find((entry) => entry.id === choice);
  if (column?.kind === "number") return numberChart(rows, column, cells);
  if (column?.kind === "category") return categoryChart(rows, column, cells);
  return foundChart(rows, columns, cells);
}

// ---------------------------------------------------------------------------
// Downloads. Each takes the columns shown.

export function cellText(cell: TableCell | undefined): string {
  if (!cell) return "";
  if (cell.status === "found") return cell.note ? `${cell.value} (${cell.note})` : cell.value;
  if (cell.status === "not_stated") return "Not stated";
  if (cell.status === "unverified") return "Not confirmed";
  return "";
}

/** The table as CSV: each column's value, then the paper's sentence for it, so the file can be checked and cited. */
export function paperTableCsv(name: string, rows: TableRow[], columns: TableColumn[], cells: TableCells): ChartCsv {
  return {
    name,
    header: ["Paper", "Year", ...columns.flatMap((column) => [column.name, `${column.name}: sentence in the paper`])],
    rows: rows.map((row) => [
      row.title,
      row.year,
      ...columns.flatMap((column) => {
        const cell = cells[cellKey(row.paperId, column.id)];
        return [cellText(cell), cell?.status === "found" ? cell.quote : ""];
      }),
    ]),
  };
}

export type SheetCell = string | number | null;

export interface Sheet {
  name: string;
  rows: SheetCell[][];
  /** Column widths in characters. */
  widths: number[];
}

const STATUS_WORDS: Record<CellStatus, string> = { found: "Found", not_stated: "Not stated", unverified: "Not confirmed", failed: "Not read yet" };

/**
 * The table as a workbook: "Table" as it is on screen, a number column as
 * numbers a spreadsheet can add up, and "Sources", one line per cell with
 * its value, note, the paper's sentence and whether it was found.
 */
export function paperTableSheets(rows: TableRow[], columns: TableColumn[], cells: TableCells): Sheet[] {
  const table: Sheet = {
    name: "Table",
    rows: [
      ["Paper", "Year", ...columns.map((column) => column.name)],
      ...rows.map((row) => [
        row.title,
        cellNumber(row.year) ?? row.year,
        ...columns.map((column) => {
          const cell = cells[cellKey(row.paperId, column.id)];
          if (column.kind === "number" && cell?.status === "found") return cellNumber(cell.value) ?? cell.value;
          return cellText(cell);
        }),
      ]),
    ],
    widths: [60, 8, ...columns.map((column) => (column.kind === "text" ? 40 : 18))],
  };
  const sources: Sheet = {
    name: "Sources",
    rows: [
      ["Paper", "Year", "Column", "Value", "Note", "Sentence in the paper", "Status"],
      ...rows.flatMap((row) =>
        columns.map((column) => {
          const cell = cells[cellKey(row.paperId, column.id)];
          return [
            row.title,
            cellNumber(row.year) ?? row.year,
            column.name,
            cell?.status === "found" ? cell.value : "",
            cell?.status === "found" ? cell.note : "",
            cell?.status === "found" ? cell.quote : "",
            cell ? STATUS_WORDS[cell.status] : "Not read yet",
          ];
        })
      ),
    ],
    widths: [60, 8, 24, 30, 24, 80, 14],
  };
  return [table, sources];
}

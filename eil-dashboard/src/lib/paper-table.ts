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
import { COLUMN_PRESETS, type ColumnPreset } from "@/lib/paper-table-presets";

/** Columns a table can hold, shown or hidden: every ready-made one and some of the reader's own. */
export const MAX_COLUMNS = 80;
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

const PRESET_BY_NAME = new Map(COLUMN_PRESETS.map((preset) => [preset.name.toLowerCase(), preset.key]));

/**
 * How the column picker names a column: a ready-made one by its preset, the
 * reader's own by its id. A column made before columns recorded their preset
 * (the first seven, 2026-10-28) is matched by its name, so the picker ticks
 * it in its group instead of offering it again as a second column.
 */
export function columnChoiceKey(column: Pick<TableColumn, "id" | "preset" | "name">): string {
  const preset = column.preset ?? PRESET_BY_NAME.get(column.name.trim().toLowerCase());
  return preset ? `preset:${preset}` : `column:${column.id}`;
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
// Downloads. Each takes the columns shown.

/** The number a value starts with ("180 students" -> 180, "1,200 texts" -> 1200), or null. */
export function cellNumber(value: string): number | null {
  const match = String(value ?? "").match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

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

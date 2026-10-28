/*
 * The paper table (docs/42): one row per study, one column per thing the
 * reader wants from each, and every cell kept only with the sentence it came
 * from. The competitor review ranked it the largest gap (docs/41): Elicit,
 * SciSpace and NotebookLM all lay papers out against the reader's own columns.
 *
 * This file is what the page and the server share; the reading itself is in
 * paper-table-reading.ts, on the server.
 */
import { z } from "zod";
import type { ChartCsv } from "@/lib/chart-csv";

export const MAX_COLUMNS = 8;
/** Rows read for one table; a repository with more is read in its first this many. */
export const MAX_TABLE_PAPERS = 120;
export const MAX_TABLES_PER_REPOSITORY = 30;

export type ColumnKind = "text" | "number";

export interface TableColumn {
  id: string;
  name: string;
  /** What to read for it, in the reader's words; the name alone when empty. */
  instruction: string;
  kind: ColumnKind;
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

/** Columns most reviews start from; each is added as an ordinary column the reader can change. */
export const COLUMN_PRESETS: Array<Omit<TableColumn, "id">> = [
  { name: "Participants", instruction: "Who took part and how many in all, e.g. '60 Thai EFL undergraduates'.", kind: "text" },
  { name: "Sample size", instruction: "The total number of participants in the study.", kind: "number" },
  { name: "Setting", instruction: "The country and the kind of school or university where the study took place.", kind: "text" },
  { name: "Research design", instruction: "The study's design, e.g. quasi-experimental, case study, survey, mixed methods.", kind: "text" },
  { name: "Instruments", instruction: "The tests, questionnaires, interviews or other instruments used to collect data.", kind: "text" },
  { name: "Duration", instruction: "How long the study or its intervention lasted.", kind: "text" },
  { name: "Main finding", instruction: "The study's main finding, in one sentence.", kind: "text" },
];

const ColumnSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  instruction: z.string().trim().max(300).default(""),
  kind: z.enum(["text", "number"]).default("text"),
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

/**
 * Columns whose meaning changed, so their cells are read again: a new
 * instruction or kind, or a new name where the name is all there is. A column
 * only renamed keeps its cells.
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

/** The cells a fill reads: those not read yet, and those whose call failed. */
export function missingCells(rows: TableRow[], columns: TableColumn[], cells: TableCells): Array<{ paperId: string; columnId: string }> {
  return rows.flatMap((row) =>
    columns
      .filter((column) => {
        const cell = cells[cellKey(row.paperId, column.id)];
        return !cell || cell.status === "failed";
      })
      .map((column) => ({ paperId: row.paperId, columnId: column.id }))
  );
}

// ---------------------------------------------------------------------------
// Download.

function cellText(cell: TableCell | undefined): string {
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

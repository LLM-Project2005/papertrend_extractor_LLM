/*
 * The paper table (docs/42): one row per study, one column per thing the
 * reader wants from each, and every cell kept only with the sentence it came
 * from. The competitor review ranked it the largest gap (docs/41): Elicit,
 * SciSpace and NotebookLM all lay papers out against the reader's own columns.
 * The rows can be sorted and filtered, and a paper left out of a table, by hand
 * or by a yes/no column's No (2026-10-29).
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
/** Rows read for one table; a repository with more is read in its newest this many. */
export const MAX_TABLE_PAPERS = 120;
export const MAX_TABLES_PER_REPOSITORY = 30;
/** Papers a table can leave out, counting any no longer in the repository. */
export const MAX_LEFT_OUT = 500;

/**
 * yesno: a rule each paper meets or not ("empirical studies with university
 * students"), answered Yes or No with the sentence that decides it; the
 * papers that say No can then be left out, as a review screens its studies.
 */
export type ColumnKind = "text" | "number" | "category" | "yesno";

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
 * unverified: an answer whose sentence (or number) is not in the paper; never shown as a value,
 *   only in the cell's panel, with a warning, and never downloaded.
 * failed: the call that read it failed; read again with the next fill.
 */
export type CellStatus = "found" | "not_stated" | "unverified" | "failed";

export interface TableCell {
  value: string;
  quote: string;
  note: string;
  status: CellStatus;
  /**
   * Read from the whole paper, or on a second look; "Read again" passes it by.
   * A cell read before second looks (2026-10-28) has none.
   */
  readWhole?: boolean;
}

/** Cells by `${paperId}:${columnId}`, so a fill merges into the stored table key by key. */
export type TableCells = Record<string, TableCell>;

export interface TableRow {
  paperId: string;
  runId: string;
  title: string;
  year: string;
}

/**
 * Papers the reader left out of a table, by paper id: why, in their words or
 * from the yes/no column whose No left it out. A paper left out is not shown,
 * read or downloaded; its cells are kept, so putting it back reads nothing.
 */
export type LeftOut = Record<string, { reason: string; columnId?: string }>;

/** A left-out paper as the page lists it. */
export interface LeftOutRow extends TableRow {
  reason: string;
  columnId?: string;
}

export function cellKey(paperId: string, columnId: string): string {
  return `${paperId}:${columnId}`;
}

const ColumnIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

const ColumnSchema = z.object({
  id: ColumnIdSchema,
  name: z.string().trim().min(1).max(60),
  instruction: z.string().trim().max(300).default(""),
  kind: z.enum(["text", "number", "category", "yesno"]).default("text"),
  hidden: z.boolean().optional(),
  preset: ColumnIdSchema.optional(),
});

const PaperIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);

export const LeaveOutSchema = z
  .array(z.object({ paperId: PaperIdSchema, reason: z.string().trim().max(200).default(""), columnId: ColumnIdSchema.optional() }))
  .max(MAX_LEFT_OUT);
export const PutBackSchema = z.array(PaperIdSchema).max(MAX_LEFT_OUT);

/** The papers left out after leaving some out and putting some back; the newest reason stands. */
export function changeLeftOut(
  current: LeftOut,
  leave: Array<{ paperId: string; reason: string; columnId?: string }> = [],
  putBack: string[] = []
): LeftOut {
  const next: LeftOut = { ...current };
  for (const paperId of putBack) delete next[paperId];
  for (const { paperId, reason, columnId } of leave) next[paperId] = columnId ? { reason, columnId } : { reason };
  // The oldest go first past the limit; a table of papers since deleted could otherwise fill it.
  const keys = Object.keys(next);
  for (const paperId of keys.slice(0, Math.max(0, keys.length - MAX_LEFT_OUT))) delete next[paperId];
  return next;
}

/** A yes/no cell's answer, "Yes" or "No", or null when it is neither. */
export function yesNo(value: string): "Yes" | "No" | null {
  const match = String(value ?? "").trim().match(/^(yes|no)\b/i);
  if (!match) return null;
  return match[1].toLowerCase() === "yes" ? "Yes" : "No";
}

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

/**
 * The cells "Read again" reads: in the columns shown (or those given), each
 * "Not stated" or "Not confirmed" that has not had the whole paper read for it.
 * A fill reads only empty cells, so without this a cell read before a fix to
 * the reading kept its old answer (2026-10-28).
 */
export function doubtfulCells(
  rows: TableRow[],
  columns: TableColumn[],
  cells: TableCells,
  columnIds?: string[]
): Array<{ paperId: string; columnId: string }> {
  const shown = visibleColumns(columns).filter((column) => !columnIds || columnIds.includes(column.id));
  return rows.flatMap((row) =>
    shown
      .filter((column) => {
        const cell = cells[cellKey(row.paperId, column.id)];
        return Boolean(cell && (cell.status === "not_stated" || cell.status === "unverified") && !cell.readWhole);
      })
      .map((column) => ({ paperId: row.paperId, columnId: column.id }))
  );
}

/**
 * The cells named by key, in the columns shown and the rows given: one cell's
 * "Read again", from its panel, whatever the cell says now.
 */
export function cellsByKey(rows: TableRow[], columns: TableColumn[], keys: string[]): Array<{ paperId: string; columnId: string }> {
  const wanted = new Set(keys);
  return rows.flatMap((row) =>
    visibleColumns(columns)
      .filter((column) => wanted.has(cellKey(row.paperId, column.id)))
      .map((column) => ({ paperId: row.paperId, columnId: column.id }))
  );
}

/**
 * A table's studies: past `max`, the newest, since a table of where a field
 * is going needs its latest work; listed oldest first, as a review lists them.
 */
export function tableStudies<T extends { year: string; title: string }>(studies: T[], max = MAX_TABLE_PAPERS): T[] {
  const year = (study: T) => Number(study.year) || null;
  const newest = [...studies].sort((a, b) => (year(b) ?? 0) - (year(a) ?? 0) || a.title.localeCompare(b.title)).slice(0, max);
  return newest.sort((a, b) => (year(a) ?? 9999) - (year(b) ?? 9999) || a.title.localeCompare(b.title));
}

/** How labels are compared: case, hyphens, spacing and a plural aside ("Mixed-methods" is "Mixed methods"). */
export function labelKey(label: string): string {
  return label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―_/-]+/g, " ")
    .replace(/[^\p{L}\p{M}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word.length <= 3 || /(?:ss|us|is)$/.test(word) ? word : word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.replace(/s$/, "")))
    .join(" ");
}

/**
 * A short-label column's labels, each worded one way. Papers are read a few
 * to a call, so nothing makes their labels match: one table had Mixed methods
 * 12 times, Mixed-methods 9 and Mixed-method 2 (2026-10-28). Labels that
 * differ only as labelKey allows are shown as their commonest spelling. The
 * stored cells keep what was read; the page and its downloads show these.
 */
export function tidyLabels(columns: TableColumn[], cells: TableCells): TableCells {
  const labelColumns = new Set(columns.filter((column) => column.kind === "category").map((column) => column.id));
  if (labelColumns.size === 0) return cells;
  const parts = (value: string) => value.split(";").map((part) => part.trim()).filter(Boolean);
  const labelCells = Object.entries(cells).filter(
    ([key, cell]) => cell.status === "found" && labelColumns.has(key.slice(key.indexOf(":") + 1))
  );
  // Each spelling's count, by column and key.
  const spellings = new Map<string, Map<string, number>>();
  for (const [key, cell] of labelCells) {
    const columnId = key.slice(key.indexOf(":") + 1);
    for (const part of parts(cell.value)) {
      const group = `${columnId}\u0000${labelKey(part)}`;
      const counts = spellings.get(group) ?? new Map<string, number>();
      counts.set(part, (counts.get(part) ?? 0) + 1);
      spellings.set(group, counts);
    }
  }
  const chosen = new Map(
    [...spellings].map(([group, counts]) => [group, [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]])
  );
  let tidy: TableCells | null = null;
  for (const [key, cell] of labelCells) {
    const columnId = key.slice(key.indexOf(":") + 1);
    const value = [...new Set(parts(cell.value).map((part) => chosen.get(`${columnId}\u0000${labelKey(part)}`) ?? part))].join("; ");
    if (value === cell.value) continue;
    tidy ??= { ...cells };
    tidy[key] = { ...cell, value };
  }
  return tidy ?? cells;
}

// ---------------------------------------------------------------------------
// Sorting and filtering the rows (2026-10-29, the user's request): Elicit's
// table comes after the papers are screened, and a review usually wants a
// subset, such as the experimental studies, or the studies by sample size.
// The view is the reader's own and changes no cell.

/** What a cell holds: a value, Not stated, Not confirmed, or nothing read yet. */
export type CellKind = "found" | "not_stated" | "unverified" | "empty";

export function cellKind(cell: TableCell | undefined): CellKind {
  if (!cell || cell.status === "failed") return "empty";
  return cell.status;
}

export const CELL_KIND_WORDS: Record<CellKind, string> = {
  found: "Has a value",
  not_stated: "Not stated",
  unverified: "Not confirmed",
  empty: "Not read yet",
};

export interface ColumnFilter {
  /** The kinds of cell kept; a value must also pass the tests below. Empty keeps every kind. */
  show: CellKind[];
  /** Short-label and yes/no columns: the labels kept, as shown; compared as labelKey compares them. */
  labels?: string[];
  /** Words columns: words the value or its note must contain. */
  text?: string;
  /** Number columns: the range kept, either end open. */
  min?: number | null;
  max?: number | null;
}

/** Sorting by the paper column: by year, the order the table starts in, or by title. */
export const SORT_YEAR = ":year";
export const SORT_TITLE = ":title";

export interface TableView {
  /** A column's id, SORT_YEAR or SORT_TITLE; none keeps the table's own order (oldest first). */
  sort?: { by: string; descending: boolean } | null;
  title?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  /** Filters by column id. */
  columns?: Record<string, ColumnFilter>;
}

const ColumnFilterSchema = z.object({
  show: z.array(z.enum(["found", "not_stated", "unverified", "empty"])).max(4).default([]),
  labels: z.array(z.string().max(240)).max(200).optional(),
  text: z.string().max(120).optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

const TableViewSchema = z.object({
  sort: z.object({ by: z.string().max(40), descending: z.boolean() }).nullable().optional(),
  title: z.string().max(120).optional(),
  yearFrom: z.number().nullable().optional(),
  yearTo: z.number().nullable().optional(),
  columns: z.record(z.string(), ColumnFilterSchema).optional(),
});

/** A view as stored in the browser, or none when what is stored is not one. */
export function readTableView(value: unknown): TableView {
  const parsed = TableViewSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function labelParts(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function filterIsSet(filter: ColumnFilter | undefined): boolean {
  if (!filter) return false;
  return filter.show.length > 0 || Boolean(filter.labels?.length || filter.text?.trim() || filter.min != null || filter.max != null);
}

/** Whether a cell passes its column's filter. */
export function cellPasses(cell: TableCell | undefined, filter: ColumnFilter): boolean {
  const kind = cellKind(cell);
  if (filter.show.length > 0 && !filter.show.includes(kind)) return false;
  if (kind !== "found" || !cell) return true;
  if (filter.labels?.length) {
    const kept = new Set(filter.labels.map(labelKey));
    if (!labelParts(cell.value).some((part) => kept.has(labelKey(part)))) return false;
  }
  const words = filter.text?.trim().toLowerCase();
  if (words && !`${cell.value} ${cell.note}`.toLowerCase().includes(words)) return false;
  if (filter.min != null || filter.max != null) {
    const number = cellNumber(cell.value);
    if (number === null) return false;
    if (filter.min != null && number < filter.min) return false;
    if (filter.max != null && number > filter.max) return false;
  }
  return true;
}

function yearOf(row: TableRow): number | null {
  return Number(row.year) || null;
}

/** Whether a row passes the view's filters, on the columns shown. */
export function rowPasses(row: TableRow, columns: TableColumn[], cells: TableCells, view: TableView): boolean {
  const title = view.title?.trim().toLowerCase();
  if (title && !row.title.toLowerCase().includes(title)) return false;
  if (view.yearFrom != null || view.yearTo != null) {
    const year = yearOf(row);
    if (year === null) return false;
    if (view.yearFrom != null && year < view.yearFrom) return false;
    if (view.yearTo != null && year > view.yearTo) return false;
  }
  for (const column of visibleColumns(columns)) {
    const filter = view.columns?.[column.id];
    if (filterIsSet(filter) && !cellPasses(cells[cellKey(row.paperId, column.id)], filter!)) return false;
  }
  return true;
}

const KIND_ORDER: Record<CellKind, number> = { found: 0, not_stated: 1, unverified: 2, empty: 3 };

/**
 * The rows in the view's order. Values sort by number in a number column and
 * by their words otherwise; a cell without a value goes last either way, and
 * ties keep the table's own order.
 */
export function sortRows(rows: TableRow[], columns: TableColumn[], cells: TableCells, sort: TableView["sort"]): TableRow[] {
  if (!sort) return rows;
  const direction = sort.descending ? -1 : 1;
  const words = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const indexed = rows.map((row, index) => ({ row, index }));
  if (sort.by === SORT_YEAR || sort.by === SORT_TITLE) {
    indexed.sort((a, b) => {
      if (sort.by === SORT_TITLE) return words(a.row.title, b.row.title) * direction || a.index - b.index;
      const ya = yearOf(a.row);
      const yb = yearOf(b.row);
      if (ya === null || yb === null) return (ya === null ? 1 : 0) - (yb === null ? 1 : 0) || a.index - b.index;
      return (ya - yb) * direction || a.index - b.index;
    });
    return indexed.map(({ row }) => row);
  }
  const column = columns.find((entry) => entry.id === sort.by);
  if (!column) return rows;
  const cellOf = (row: TableRow) => cells[cellKey(row.paperId, column.id)];
  indexed.sort((a, b) => {
    const ca = cellOf(a.row);
    const cb = cellOf(b.row);
    const kinds = KIND_ORDER[cellKind(ca)] - KIND_ORDER[cellKind(cb)];
    if (kinds !== 0) return kinds;
    if (cellKind(ca) !== "found") return a.index - b.index;
    if (column.kind === "number") {
      const na = cellNumber(ca!.value);
      const nb = cellNumber(cb!.value);
      if (na === null || nb === null) return (na === null ? 1 : 0) - (nb === null ? 1 : 0) || a.index - b.index;
      return (na - nb) * direction || a.index - b.index;
    }
    return words(ca!.value, cb!.value) * direction || a.index - b.index;
  });
  return indexed.map(({ row }) => row);
}

/** The rows the view shows, in its order. */
export function viewRows(rows: TableRow[], columns: TableColumn[], cells: TableCells, view: TableView): TableRow[] {
  return sortRows(
    rows.filter((row) => rowPasses(row, columns, cells, view)),
    columns,
    cells,
    view.sort
  );
}

/** Whether the view hides any row. */
export function viewFilters(view: TableView, columns: TableColumn[]): boolean {
  if (view.title?.trim() || view.yearFrom != null || view.yearTo != null) return true;
  return visibleColumns(columns).some((column) => filterIsSet(view.columns?.[column.id]));
}

/** The view without what refers to a column no longer shown, so a stale filter never hides rows unseen. */
export function cleanView(view: TableView, columns: TableColumn[]): TableView {
  const shown = new Set(visibleColumns(columns).map((column) => column.id));
  const kept = Object.fromEntries(Object.entries(view.columns ?? {}).filter(([id, filter]) => shown.has(id) && filterIsSet(filter)));
  const sort = view.sort && (view.sort.by === SORT_YEAR || view.sort.by === SORT_TITLE || shown.has(view.sort.by)) ? view.sort : null;
  return { ...view, sort, columns: kept };
}

function rangeWords(min: number | null | undefined, max: number | null | undefined): string {
  if (min != null && max != null) return `${min.toLocaleString()}–${max.toLocaleString()}`;
  return min != null ? `${min.toLocaleString()} or more` : `${(max ?? 0).toLocaleString()} or less`;
}

/** The view in words, one chip for each thing it does, keyed so each can be cleared alone. */
export function viewChips(view: TableView, columns: TableColumn[]): Array<{ key: string; label: string }> {
  const chips: Array<{ key: string; label: string }> = [];
  const title = view.title?.trim();
  if (title) chips.push({ key: "title", label: `Title has “${title}”` });
  if (view.yearFrom != null || view.yearTo != null) {
    const from = view.yearFrom;
    const to = view.yearTo;
    chips.push({ key: "years", label: from != null && to != null ? `Years ${from}–${to}` : from != null ? `From ${from}` : `Up to ${to}` });
  }
  for (const column of visibleColumns(columns)) {
    const filter = view.columns?.[column.id];
    if (!filter || !filterIsSet(filter)) continue;
    const valueTest = Boolean(filter.labels?.length || filter.text?.trim() || filter.min != null || filter.max != null);
    const parts = [
      ...(filter.labels ?? []),
      ...(filter.text?.trim() ? [`has “${filter.text.trim()}”`] : []),
      ...(filter.min != null || filter.max != null ? [rangeWords(filter.min, filter.max)] : []),
      ...filter.show.filter((kind) => !(valueTest && kind === "found")).map((kind) => CELL_KIND_WORDS[kind]),
    ];
    chips.push({ key: column.id, label: `${column.name}: ${parts.join(", ")}` });
  }
  const sort = view.sort;
  if (sort) {
    const column = columns.find((entry) => entry.id === sort.by);
    const label =
      sort.by === SORT_YEAR
        ? sort.descending
          ? "Newest first"
          : "Oldest first"
        : sort.by === SORT_TITLE
          ? `Title ${sort.descending ? "Z–A" : "A–Z"}`
          : column
            ? `${column.name}, ${column.kind === "number" ? (sort.descending ? "high to low" : "low to high") : sort.descending ? "Z–A" : "A–Z"}`
            : null;
    if (label) chips.push({ key: "sort", label: `Sorted: ${label}` });
  }
  return chips;
}

/**
 * A column's cells as a filter offers them: each label with its count (for a
 * short-label or yes/no column, labels as shown), and each kind of cell.
 */
export function columnCounts(
  rows: TableRow[],
  column: TableColumn,
  cells: TableCells
): { labels: Array<{ key: string; label: string; count: number }>; kinds: Record<CellKind, number> } {
  const kinds: Record<CellKind, number> = { found: 0, not_stated: 0, unverified: 0, empty: 0 };
  const labels = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const cell = cells[cellKey(row.paperId, column.id)];
    const kind = cellKind(cell);
    kinds[kind] += 1;
    if (kind !== "found" || !cell || (column.kind !== "category" && column.kind !== "yesno")) continue;
    for (const part of new Set(labelParts(cell.value))) {
      const key = labelKey(part);
      const entry = labels.get(key) ?? { label: part, count: 0 };
      entry.count += 1;
      labels.set(key, entry);
    }
  }
  return {
    labels: [...labels].map(([key, entry]) => ({ key, ...entry })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    kinds,
  };
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

/** Why a paper was left out, in words: the reader's reason, or the yes/no column that said No. */
export function leftOutReason(entry: { reason: string; columnId?: string }, columns: TableColumn[]): string {
  const column = entry.columnId ? columns.find((candidate) => candidate.id === entry.columnId) : undefined;
  if (entry.reason) return entry.reason;
  return column ? `${column.name}: No` : "";
}

/**
 * The table as a workbook: "Table" as it is on screen, a number column as
 * numbers a spreadsheet can add up, and "Sources", one line per cell with
 * its value, note, the paper's sentence and whether it was found. With papers
 * left out, a "Left out" sheet lists each with its reason and, when a yes/no
 * column left it out, that column's sentence: the screening record.
 */
export function paperTableSheets(rows: TableRow[], columns: TableColumn[], cells: TableCells, leftOut: LeftOutRow[] = [], allColumns: TableColumn[] = columns): Sheet[] {
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
  if (leftOut.length === 0) return [table, sources];
  const left: Sheet = {
    name: "Left out",
    rows: [
      ["Paper", "Year", "Reason", "Sentence in the paper"],
      ...leftOut.map((row) => {
        const cell = row.columnId ? cells[cellKey(row.paperId, row.columnId)] : undefined;
        return [row.title, cellNumber(row.year) ?? row.year, leftOutReason(row, allColumns), cell?.status === "found" ? cell.quote : ""];
      }),
    ],
    widths: [60, 8, 40, 80],
  };
  return [table, sources, left];
}

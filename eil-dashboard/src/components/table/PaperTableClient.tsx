"use client";

/*
 * The paper table (docs/42): the repository's studies down the side, the
 * reader's columns across the top, and in each cell what the paper says, kept
 * only when its sentence is in the paper. A value opens that sentence, and
 * the sentence opens the paper with it marked.
 *
 * Tables are saved per repository. A fill reads the empty cells and streams
 * each batch of papers back as it is read, so the table fills in on the page;
 * leaving or pressing Stop keeps what was read. "Read again" reads a cell
 * answered "Not stated" or "Not confirmed" before second looks, from the whole
 * paper. The table scrolls in a frame no taller than the screen, so its
 * sideways scrollbar is always in view (the user's request, 2026-10-28).
 *
 * Columns are shown or hidden from a picker of ready-made ones, as in an
 * analytics dashboard (2026-10-28, the user's request), and the table
 * downloads as CSV, Excel or an image.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import ColumnPicker from "@/components/table/ColumnPicker";
import TableDownloadMenu, { type DownloadFormat } from "@/components/table/TableDownloadMenu";
import {
  CloseIcon,
  PencilSquareIcon,
  PlusIcon,
  RefreshIcon,
  SpinnerIcon,
  StopIcon,
  TableIcon,
  TrashIcon,
} from "@/components/ui/Icons";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { buttonClass, fieldClass, hintClass, iconButtonClass, labelClass, panelClass } from "@/components/ui/controls";
import PaperLink from "@/components/workspace/PaperLink";
import { useTabTitleRepository } from "@/components/workspace/WorkspaceTabTitle";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { csvFileName, toCsv } from "@/lib/chart-csv";
import type { PaperTableRecord, PaperTableSummary } from "@/lib/cloudsql/paper-table-repository";
import {
  MAX_COLUMNS,
  applyColumnChoice,
  cellKey,
  doubtfulCells,
  missingCells,
  newColumnId,
  paperTableCsv,
  paperTableSheets,
  tidyLabels,
  visibleColumns,
  type ColumnKind,
  type TableCell,
  type TableCells,
  type TableColumn,
  type TableRow,
} from "@/lib/paper-table";
import { downloadPaperTablePng, saveBlob } from "@/lib/paper-table-png";
import { COLUMN_PRESETS, STARTER_SETS, type ColumnPreset } from "@/lib/paper-table-presets";
import { xlsxBytes } from "@/lib/xlsx-writer";

type Dialog =
  | { kind: "new" }
  | { kind: "column"; column: TableColumn | null }
  | { kind: "columns" }
  | { kind: "rename" }
  | { kind: "delete" };

/** The table last opened in each repository, so the page comes back to it. */
const LAST_TABLE_KEY = "papertrend_paper_table_v1";

function readLastTable(projectId: string): string | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(LAST_TABLE_KEY) ?? "{}") as Record<string, string>;
    return typeof stored[projectId] === "string" ? stored[projectId] : null;
  } catch {
    return null;
  }
}

function writeLastTable(projectId: string, tableId: string | null): void {
  try {
    const stored = JSON.parse(window.localStorage.getItem(LAST_TABLE_KEY) ?? "{}") as Record<string, string>;
    if (tableId) stored[projectId] = tableId;
    else delete stored[projectId];
    window.localStorage.setItem(LAST_TABLE_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked: the page opens the newest table instead.
  }
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function CellView({ cell, reading, again, onOpen }: { cell: TableCell | undefined; reading: boolean; again: boolean; onOpen: () => void }) {
  if (again) return <span aria-label="Reading again" className="block h-3 w-20 rounded bg-subtle motion-safe:animate-pulse" />;
  if (!cell || (reading && cell.status === "failed")) {
    return reading ? (
      <span aria-label="Reading" className="block h-3 w-20 rounded bg-subtle motion-safe:animate-pulse" />
    ) : (
      <span className="text-mute">–</span>
    );
  }
  if (cell.status === "found") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="line-clamp-4 text-left leading-6 text-ink decoration-hairline-strong decoration-dotted underline-offset-4 hover:underline focus-visible:underline"
      >
        {cell.value}
        {cell.note ? <span className="text-mute"> ({cell.note})</span> : null}
      </button>
    );
  }
  if (cell.status === "not_stated") return <span className="text-[13px] text-mute">Not stated</span>;
  if (cell.status === "unverified") {
    return (
      <span className="text-[13px] text-mute" title="An answer was given, but its sentence is not in the paper, so it is not shown.">
        Not confirmed
      </span>
    );
  }
  return <span className="text-[13px] text-mute">Not read yet</span>;
}

function QuotePanel({
  row,
  column,
  cell,
  onClose,
}: {
  row: TableRow;
  column: TableColumn;
  cell: TableCell;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // In a portal: inside the workspace's page, `fixed` placed the panel at the
  // foot of the page rather than of the screen, out of sight (pilot, 2026-10-28).
  if (typeof document === "undefined") return null;
  return createPortal(
    <aside
      aria-label={`${column.name}: where it comes from`}
      className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-hairline bg-surface p-4 shadow-overlay sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[440px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-mute">{column.name}</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-ink">
            {cell.value}
            {cell.note ? <span className="font-normal text-mute"> ({cell.note})</span> : null}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={iconButtonClass("sm")}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <blockquote className="mt-3 max-h-48 overflow-auto border-l-2 border-hairline-strong pl-3 text-sm leading-6 text-body">
        {cell.quote}
      </blockquote>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-mute">
          {row.title}
          {row.year && row.year !== "Unknown" ? ` · ${row.year}` : ""}
        </p>
        {/* As a chat citation does: the paper opens on its PDF with this sentence marked. */}
        <PaperLink paper={{ paperId: row.paperId, tab: "preview", quote: cell.quote }} className={buttonClass("secondary", "sm")}>
          Show in paper
        </PaperLink>
      </div>
    </aside>,
    document.body
  );
}

const KINDS: Array<{ value: ColumnKind; label: string; detail: string }> = [
  { value: "text", label: "Words", detail: "any length" },
  { value: "category", label: "A short label", detail: "one to four words, worded alike in every paper" },
  { value: "number", label: "A number", detail: "checked against its sentence" },
];

function ColumnDialog({
  column,
  busy,
  doubtful,
  onSave,
  onRemove,
  onReadAgain,
  onClose,
}: {
  column: TableColumn | null;
  busy: boolean;
  /** This column's cells "Read again" would read. */
  doubtful: number;
  onSave: (column: TableColumn) => void;
  onRemove: (column: TableColumn) => void;
  onReadAgain: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(column?.name ?? "");
  const [instruction, setInstruction] = useState(column?.instruction ?? "");
  const [kind, setKind] = useState<ColumnKind>(column?.kind ?? "text");
  const meaningChanges = Boolean(column) && (instruction.trim() !== column?.instruction || kind !== column?.kind || (!instruction.trim() && name.trim() !== column?.name));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({
      ...(column ?? {}),
      id: column?.id ?? newColumnId(name, []),
      name: name.trim(),
      instruction: instruction.trim(),
      kind,
    });
  }

  return (
    <Modal onClose={() => (busy ? undefined : onClose())} zIndexClassName="z-[70]">
      <form onSubmit={submit} className="w-[min(480px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay">
        <h2 className="text-base font-semibold text-ink">{column ? "Edit column" : "Add a column"}</h2>
        <label className="mt-4 block">
          <span className={labelClass}>Name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className={`mt-1.5 ${fieldClass}`} placeholder="e.g. Participants" />
        </label>
        <label className="mt-4 block">
          <span className={labelClass}>What to read from each paper</span>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            maxLength={300}
            rows={3}
            className={`mt-1.5 ${fieldClass}`}
            placeholder="e.g. Who took part and how many in all"
          />
          <span className={hintClass}>Say it as you would to a research assistant. Left empty, the name is used.</span>
        </label>
        <fieldset className="mt-4">
          <legend className={labelClass}>Kind of value</legend>
          <div className="mt-1.5 grid gap-1.5 text-sm text-body">
            {KINDS.map((entry) => (
              <label key={entry.value} className="inline-flex items-start gap-2">
                <input type="radio" name="kind" className="mt-1" value={entry.value} checked={kind === entry.value} onChange={() => setKind(entry.value)} />
                <span>
                  {entry.label} <span className="text-mute">{entry.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {meaningChanges ? <p className={hintClass}>This column&apos;s cells will be read again.</p> : null}
        {column && doubtful > 0 && !meaningChanges ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2 text-[13px] leading-5 text-body">
            <span>
              {plural(doubtful, "cell")} {doubtful === 1 ? "says" : "say"} Not stated or Not confirmed from part of a paper.
            </span>
            <button type="button" disabled={busy} onClick={onReadAgain} className={buttonClass("secondary", "sm")}>
              <RefreshIcon className="h-3.5 w-3.5" />
              Read again
            </button>
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-between gap-2">
          {column ? (
            <button type="button" disabled={busy} onClick={() => onRemove(column)} className={buttonClass("danger", "sm")}>
              <TrashIcon className="h-3.5 w-3.5" />
              Remove column
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onClose} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()} className={buttonClass("primary", "sm")}>
              {column ? "Save" : "Add and read"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function NewTableDialog({
  busy,
  onCreate,
  onClose,
}: {
  busy: boolean;
  onCreate: (name: string, columns: TableColumn[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("Study details");
  const [starter, setStarter] = useState(STARTER_SETS[0].id);
  function submit(event: FormEvent) {
    event.preventDefault();
    const keys = new Set((STARTER_SETS.find((set) => set.id === starter)?.keys ?? []).map((key) => `preset:${key}`));
    onCreate(name.trim() || "Study details", applyColumnChoice([], keys, COLUMN_PRESETS));
  }
  return (
    <Modal onClose={() => (busy ? undefined : onClose())} zIndexClassName="z-[70]">
      <form onSubmit={submit} className="w-[min(520px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay">
        <h2 className="text-base font-semibold text-ink">New table</h2>
        <label className="mt-4 block">
          <span className={labelClass}>Name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className={`mt-1.5 ${fieldClass}`} />
        </label>
        <fieldset className="mt-4">
          <legend className={labelClass}>Start with</legend>
          <div className="mt-2 grid gap-1">
            {STARTER_SETS.map((set) => (
              <label key={set.id} className="flex cursor-pointer gap-3 rounded-lg px-2.5 py-2 hover:bg-subtle">
                <input type="radio" name="starter" className="mt-1" checked={starter === set.id} onChange={() => setStarter(set.id)} />
                <span>
                  <span className="block text-sm font-medium text-ink">{set.label}</span>
                  <span className="block text-[13px] leading-5 text-mute">{set.description}</span>
                </span>
              </label>
            ))}
          </div>
          <p className={hintClass}>Afterwards, Columns shows or hides any of the {COLUMN_PRESETS.length} ready-made columns, and you can write your own.</p>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={buttonClass("secondary", "sm")}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>
            {starter === "empty" ? "Make table" : "Make and read"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function PaperTableClient() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { currentProject } = useWorkspaceProfile();
  const projectId = currentProject?.id ?? null;
  useTabTitleRepository(currentProject?.name);

  const [tables, setTables] = useState<PaperTableSummary[] | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [table, setTable] = useState<PaperTableRecord | null>(null);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [more, setMore] = useState(0);
  const [loadingTable, setLoadingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState<{ done: number; total: number } | null>(null);
  // Cells being read again; each shows as reading until its new answer comes.
  const [rereading, setRereading] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<{ paperId: string; columnId: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const fillRef = useRef<AbortController | null>(null);
  const fillingTableRef = useRef<string | null>(null);
  // A table just made with columns is read as soon as it has opened, so its rows are there for the cells.
  const fillWhenOpenRef = useRef<string | null>(null);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
      });
      const data = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) throw new Error(data.error || "That did not work just now. Try again in a moment.");
      return data;
    },
    [token]
  );

  const fill = useCallback(
    /** `again`: "Read again", with the cells it reads (keys) and the columns it keeps to. */
    async (id: string, again?: { keys: string[]; columnIds?: string[] }) => {
      if (!token) return;
      fillRef.current?.abort();
      const controller = new AbortController();
      fillRef.current = controller;
      fillingTableRef.current = id;
      setError(null);
      setNotice(null);
      setFilling({ done: 0, total: 0 });
      setRereading(new Set(again?.keys ?? []));
      let found = 0;
      let read = 0;
      try {
        const response = await fetch(`/api/workspace/tables/${id}/fill`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(again ? { again: true, ...(again.columnIds ? { columnIds: again.columnIds } : {}) } : {}),
          signal: controller.signal,
        });
        if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").includes("ndjson")) {
          const data = (await response.json().catch(() => ({}))) as { error?: string; done?: boolean };
          if (!response.ok) throw new Error(data.error || "The table could not be filled just now.");
          setNotice("Every cell has been read.");
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as
              | { type: "start"; cells: number }
              | { type: "cells"; cells: TableCells; done: number }
              | { type: "done"; found: number }
              | { type: "error"; error: string };
            if (event.type === "start") setFilling({ done: 0, total: event.cells });
            else if (event.type === "cells") {
              read = event.done;
              setFilling((current) => ({ done: event.done, total: current?.total ?? event.done }));
              setTable((current) => (current && current.id === id ? { ...current, cells: { ...current.cells, ...event.cells } } : current));
              setRereading((current) => {
                if (current.size === 0) return current;
                const next = new Set(current);
                for (const key of Object.keys(event.cells)) next.delete(key);
                return next;
              });
            } else if (event.type === "done") found = event.found;
            else if (event.type === "error") throw new Error(event.error);
          }
        }
        setNotice(`Read ${plural(read, "cell")}: ${plural(found, "value")} found in the papers.`);
      } catch (reason) {
        if (controller.signal.aborted) setNotice("Stopped. What was read is kept; fill again to read the rest.");
        else setError(reason instanceof Error ? reason.message : "The table could not be filled just now.");
      } finally {
        if (fillRef.current === controller) {
          fillRef.current = null;
          fillingTableRef.current = null;
        }
        setFilling(null);
        setRereading(new Set());
      }
    },
    [token]
  );

  // The repository's tables; the last one opened here, or the newest, is opened.
  useEffect(() => {
    if (!token || !projectId) return;
    let cancelled = false;
    setTables(null);
    setTable(null);
    setTableId(null);
    setError(null);
    call<{ tables: PaperTableSummary[] }>(`/api/workspace/tables?projectId=${encodeURIComponent(projectId)}`)
      .then((data) => {
        if (cancelled) return;
        setTables(data.tables);
        const last = readLastTable(projectId);
        setTableId(data.tables.some((entry) => entry.id === last) ? last : data.tables[0]?.id ?? null);
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setTables([]);
          setError(reason.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [call, projectId, token]);

  useEffect(() => {
    if (!tableId || !token) return;
    let cancelled = false;
    // Another table stops a fill; the same table loaded again (a refreshed sign-in) does not.
    if (fillingTableRef.current && fillingTableRef.current !== tableId) fillRef.current?.abort();
    setLoadingTable(true);
    setSelected(null);
    setNotice(null);
    if (projectId) writeLastTable(projectId, tableId);
    call<{ table: PaperTableRecord; rows: TableRow[]; more: number }>(`/api/workspace/tables/${tableId}`)
      .then((data) => {
        if (cancelled) return;
        setTable(data.table);
        setRows(data.rows);
        setMore(data.more);
        if (fillWhenOpenRef.current === data.table.id) {
          fillWhenOpenRef.current = null;
          void fill(data.table.id);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingTable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [call, fill, projectId, tableId, token]);

  // Leaving the page stops a fill; what was read is kept.
  useEffect(() => () => fillRef.current?.abort(), []);


  async function createTable(name: string, columns: TableColumn[]) {
    if (!projectId) return;
    setBusy(true);
    try {
      const { table: created } = await call<{ table: PaperTableRecord }>("/api/workspace/tables", {
        method: "POST",
        body: JSON.stringify({ projectId, name, columns }),
      });
      setTables((current) => [{ ...created }, ...(current ?? [])]);
      setDialog(null);
      setTableId(created.id);
      if (columns.length > 0) fillWhenOpenRef.current = created.id;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The table could not be made.");
    } finally {
      setBusy(false);
    }
  }

  async function saveColumns(columns: TableColumn[], readAfter: boolean) {
    if (!table) return;
    setBusy(true);
    try {
      const { table: updated } = await call<{ table: PaperTableRecord }>(`/api/workspace/tables/${table.id}`, {
        method: "PATCH",
        body: JSON.stringify({ columns }),
      });
      setTable(updated);
      setDialog(null);
      if (readAfter && missingCells(rows, updated.columns, updated.cells).length > 0) void fill(updated.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The columns could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function applyChoice(chosen: Set<string>, presets: ColumnPreset[]) {
    void saveColumns(applyColumnChoice(columns, chosen, presets), true);
  }

  async function download(format: DownloadFormat) {
    if (!table) return;
    const shownColumns = visibleColumns(table.columns);
    const base = csvFileName(table.name).replace(/\.csv$/, "");
    try {
      // The cells as shown, labels tidied.
      if (format === "csv") {
        const csv = paperTableCsv(table.name, rows, shownColumns, cells);
        saveBlob(new Blob([toCsv(csv.header, csv.rows)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
      } else if (format === "xlsx") {
        const bytes = xlsxBytes(paperTableSheets(rows, shownColumns, cells));
        saveBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${base}.xlsx`);
      } else {
        await downloadPaperTablePng(
          {
            title: table.name,
            subtitle: `${plural(rows.length, "study", "studies")}${currentProject ? ` in ${currentProject.name}` : ""} · ${plural(shownColumns.length, "column")}`,
            rows,
            columns: shownColumns,
            cells,
            footnote: `Papertrend · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · a value is kept only when the paper's own sentence states it`,
          },
          `${base}.png`
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file could not be made.");
    }
  }

  async function rename(name: string) {
    if (!table || !name.trim()) return;
    setBusy(true);
    try {
      const { table: updated } = await call<{ table: PaperTableRecord }>(`/api/workspace/tables/${table.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      setTable(updated);
      setTables((current) => (current ?? []).map((entry) => (entry.id === updated.id ? { ...entry, name: updated.name } : entry)));
      setDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The table could not be renamed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeTable() {
    if (!table) return;
    setBusy(true);
    try {
      fillRef.current?.abort();
      await call(`/api/workspace/tables/${table.id}`, { method: "DELETE" });
      const remaining = (tables ?? []).filter((entry) => entry.id !== table.id);
      setTables(remaining);
      setTable(null);
      setTableId(remaining[0]?.id ?? null);
      if (projectId) writeLastTable(projectId, remaining[0]?.id ?? null);
      setDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The table could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo(() => table?.columns ?? [], [table?.columns]);
  const shown = useMemo(() => visibleColumns(columns), [columns]);
  const cells = useMemo(() => tidyLabels(columns, table?.cells ?? {}), [columns, table?.cells]);
  const counts = useMemo(() => {
    const total = { found: 0, notStated: 0, unverified: 0 };
    for (const row of rows) {
      for (const column of shown) {
        const cell = cells[cellKey(row.paperId, column.id)];
        if (cell?.status === "found") total.found += 1;
        else if (cell?.status === "not_stated") total.notStated += 1;
        else if (cell?.status === "unverified") total.unverified += 1;
      }
    }
    return total;
  }, [cells, shown, rows]);
  const missing = useMemo(() => missingCells(rows, columns, cells).length, [cells, columns, rows]);
  const doubtful = useMemo(() => doubtfulCells(rows, columns, cells), [cells, columns, rows]);
  function readAgain(columnIds?: string[]) {
    if (!table) return;
    const keys = (columnIds ? doubtful.filter((cell) => columnIds.includes(cell.columnId)) : doubtful).map((cell) => cellKey(cell.paperId, cell.columnId));
    void fill(table.id, { keys, columnIds });
  }
  const selectedRow = selected ? rows.find((row) => row.paperId === selected.paperId) : undefined;
  const selectedColumn = selected ? columns.find((column) => column.id === selected.columnId) : undefined;
  const selectedCell = selected ? cells[cellKey(selected.paperId, selected.columnId)] : undefined;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 pb-24 pt-2 sm:pt-4">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Table</h1>
          <p className="mt-2 text-[15px] leading-7 text-body">
            One row for each study{currentProject ? ` in ${currentProject.name}` : ""}, one column for each thing you want from it. A cell is filled
            only when the paper&apos;s own sentence says so; select a value to see that sentence, and open it in the paper.
          </p>
        </div>
        {tables && tables.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={tableId ?? tables[0].id}
              options={tables.map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(value) => setTableId(value)}
              label="Open a table"
              align="end"
            />
            <button type="button" onClick={() => setDialog({ kind: "new" })} className={buttonClass("secondary")}>
              <PlusIcon className="h-4 w-4" />
              New table
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {!projectId ? (
        <p className="text-sm text-body">Choose a repository to make a table of its papers.</p>
      ) : tables === null ? (
        <p className="flex items-center gap-2 text-sm text-mute">
          <SpinnerIcon className="h-4 w-4" />
          Loading tables…
        </p>
      ) : tables.length === 0 ? (
        <section className={`${panelClass} flex flex-col items-start gap-4 p-6 sm:p-8`}>
          <TableIcon className="h-8 w-8 text-mute" />
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-ink">Make a table of your papers</h2>
            <p className="mt-2 text-sm leading-6 text-body">
              Choose what you want from each study (participants, setting, design, instruments, findings, or anything you name) and every
              paper is read for it. Each value keeps the sentence it came from, and the table downloads as CSV, Excel or an image.
            </p>
          </div>
          <button type="button" onClick={() => setDialog({ kind: "new" })} className={buttonClass("primary")}>
            <PlusIcon className="h-4 w-4" />
            New table
          </button>
        </section>
      ) : loadingTable && !table ? (
        <p className="flex items-center gap-2 text-sm text-mute">
          <SpinnerIcon className="h-4 w-4" />
          Opening the table…
        </p>
      ) : table ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-1 min-w-0 truncate text-lg font-semibold text-ink">{table.name}</h2>
            <button
              type="button"
              onClick={() => {
                setRenameDraft(table.name);
                setDialog({ kind: "rename" });
              }}
              aria-label="Rename table"
              className={iconButtonClass("sm")}
            >
              <PencilSquareIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setDialog({ kind: "delete" })} aria-label="Delete table" className={iconButtonClass("sm")}>
              <TrashIcon className="h-4 w-4" />
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <TableDownloadMenu disabled={shown.length === 0 || rows.length === 0} onDownload={download} />
              <button type="button" disabled={Boolean(filling)} onClick={() => setDialog({ kind: "columns" })} className={buttonClass("secondary", "sm")}>
                <TableIcon className="h-3.5 w-3.5" />
                Columns
                <span className="tabular-nums text-mute">{shown.length}</span>
              </button>
              <button
                type="button"
                disabled={columns.length >= MAX_COLUMNS || Boolean(filling)}
                onClick={() => setDialog({ kind: "column", column: null })}
                className={buttonClass("secondary", "sm")}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add column
              </button>
              {filling ? (
                <button type="button" onClick={() => fillRef.current?.abort()} className={buttonClass("secondary", "sm")}>
                  <StopIcon className="h-3.5 w-3.5" />
                  Stop
                </button>
              ) : (
                <>
                  {doubtful.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => readAgain()}
                      title="Read the cells marked Not stated or Not confirmed again, each from the whole paper"
                      className={buttonClass("secondary", "sm")}
                    >
                      <RefreshIcon className="h-3.5 w-3.5" />
                      Read again
                      <span className="tabular-nums text-mute">{doubtful.length}</span>
                    </button>
                  ) : null}
                  <button type="button" disabled={missing === 0 || shown.length === 0} onClick={() => void fill(table.id)} className={buttonClass("primary", "sm")}>
                    Fill table
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="text-[13px] leading-5 text-mute" aria-live="polite">
            {filling
              ? `Reading the papers… ${filling.total > 0 ? `${plural(filling.done, "cell")} of ${filling.total.toLocaleString()}` : ""}`
              : notice ??
                [
                  plural(rows.length, "study", "studies"),
                  plural(shown.length, "column"),
                  counts.found ? `${plural(counts.found, "value")} found` : null,
                  counts.notStated ? `${counts.notStated.toLocaleString()} not stated` : null,
                  counts.unverified ? `${counts.unverified.toLocaleString()} not confirmed` : null,
                  missing && shown.length ? `${plural(missing, "cell")} to read` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
            {more > 0 ? ` · the newest ${rows.length.toLocaleString()} of ${(rows.length + more).toLocaleString()} studies are shown` : ""}
          </p>

          {shown.length === 0 ? (
            <div className={`${panelClass} p-6 text-sm text-body`}>
              Choose columns to show, or write your own, to say what to read from each paper.
            </div>
          ) : rows.length === 0 ? (
            <div className={`${panelClass} p-6 text-sm text-body`}>This repository has no analysed papers yet.</div>
          ) : (
            // No taller than the screen below the workspace bar, so the sideways scrollbar is in view
            // without scrolling the page to the table's end; the header row and paper column stay put.
            <div
              className="max-h-[max(20rem,calc(100dvh-19rem))] overflow-auto rounded-xl border border-hairline bg-surface shadow-raise"
              data-paper-list=""
              data-table-frame=""
            >
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 top-0 z-30 w-[150px] min-w-[150px] border-b border-r border-hairline bg-surface px-3 py-3 text-left align-bottom font-medium text-ink sm:w-[280px] sm:min-w-[220px] sm:px-4">
                      Paper
                    </th>
                    {shown.map((column) => (
                      <th key={column.id} scope="col" className="sticky top-0 z-20 min-w-[220px] max-w-[340px] border-b border-hairline bg-surface px-4 py-3 text-left align-bottom font-medium text-ink">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate">{column.name}</span>
                          <button
                            type="button"
                            disabled={Boolean(filling)}
                            onClick={() => setDialog({ kind: "column", column })}
                            aria-label={`Edit column ${column.name}`}
                            className={iconButtonClass("sm", "h-6 w-6")}
                          >
                            <PencilSquareIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {column.instruction ? <p className="mt-0.5 line-clamp-2 text-xs font-normal leading-5 text-mute">{column.instruction}</p> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.paperId}>
                      <th scope="row" className="sticky left-0 z-10 w-[150px] min-w-[150px] border-b border-r border-hairline bg-surface px-3 py-3 text-left align-top font-normal sm:w-[280px] sm:min-w-[220px] sm:px-4">
                        <PaperLink paper={{ paperId: row.paperId }} className="line-clamp-3 text-[13px] font-medium leading-5 text-ink hover:underline sm:text-sm sm:leading-6">
                          {row.title}
                        </PaperLink>
                        {row.year && row.year !== "Unknown" ? <span className="text-xs text-mute">{row.year}</span> : null}
                      </th>
                      {shown.map((column) => {
                        const key = cellKey(row.paperId, column.id);
                        const isSelected = selected?.paperId === row.paperId && selected.columnId === column.id;
                        return (
                          <td key={key} className={`min-w-[220px] max-w-[340px] border-b border-hairline px-4 py-3 align-top ${isSelected ? "bg-subtle" : ""}`}>
                            <CellView
                              cell={cells[key]}
                              reading={Boolean(filling)}
                              again={rereading.has(key)}
                              onOpen={() => setSelected({ paperId: row.paperId, columnId: column.id })}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {selectedRow && selectedColumn && selectedCell?.status === "found" ? (
        <QuotePanel row={selectedRow} column={selectedColumn} cell={selectedCell} onClose={() => setSelected(null)} />
      ) : null}

      {dialog?.kind === "new" ? (
        <NewTableDialog busy={busy} onCreate={(name, chosen) => void createTable(name, chosen)} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "column" && table ? (
        <ColumnDialog
          column={dialog.column}
          busy={busy}
          doubtful={dialog.column ? doubtful.filter((cell) => cell.columnId === dialog.column?.id).length : 0}
          onClose={() => setDialog(null)}
          onReadAgain={() => {
            if (!dialog.column) return;
            const columnIds = [dialog.column.id];
            setDialog(null);
            readAgain(columnIds);
          }}
          onRemove={(column) => void saveColumns(columns.filter((entry) => entry.id !== column.id), false)}
          onSave={(column) => {
            const next = dialog.column
              ? columns.map((entry) => (entry.id === column.id ? column : entry))
              : [...columns, { ...column, id: newColumnId(column.name, columns.map((entry) => entry.id)) }];
            void saveColumns(next, true);
          }}
        />
      ) : null}
      {dialog?.kind === "columns" && table ? (
        <ColumnPicker
          columns={columns}
          studies={rows.length}
          busy={busy}
          onApply={applyChoice}
          onAddOwn={() => setDialog({ kind: "column", column: null })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "rename" && table ? (
        <Modal onClose={() => (busy ? undefined : setDialog(null))} zIndexClassName="z-[70]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void rename(renameDraft);
            }}
            className="w-[min(420px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay"
          >
            <h2 className="text-base font-semibold text-ink">Rename table</h2>
            <label className="mt-4 block">
              <span className="sr-only">Table name</span>
              <input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={120} className={fieldClass} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setDialog(null)} className={buttonClass("secondary", "sm")}>
                Cancel
              </button>
              <button type="submit" disabled={busy || !renameDraft.trim()} className={buttonClass("primary", "sm")}>
                Rename
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
      {dialog?.kind === "delete" && table ? (
        <Modal onClose={() => (busy ? undefined : setDialog(null))} zIndexClassName="z-[70]">
          <div className="w-[min(420px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay">
            <h2 className="text-base font-semibold text-ink">Delete this table?</h2>
            <p className="mt-2 text-sm leading-6 text-body">
              &ldquo;{table.name}&rdquo; and the values read for it are deleted. The papers are not touched. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setDialog(null)} className={buttonClass("secondary", "sm")}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void removeTable()} className={buttonClass("danger", "sm")}>
                Delete table
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

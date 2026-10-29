"use client";

/*
 * The paper table's rows (docs/42, 2026-10-29, the user's request): a filter
 * for each column and for the papers, the chips that say what the view does,
 * leaving a paper out with a reason, and the list of papers left out with a
 * way to put each back. Nothing here changes a cell.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useMemo, useState, type FormEvent } from "react";
import { CloseIcon, UndoIcon } from "@/components/ui/Icons";
import Modal from "@/components/ui/Modal";
import { buttonClass, chipClass, fieldClass, hintClass, labelClass } from "@/components/ui/controls";
import PaperLink from "@/components/workspace/PaperLink";
import {
  CELL_KIND_WORDS,
  cellKey,
  columnCounts,
  labelKey,
  leftOutReason,
  type CellKind,
  type ColumnFilter,
  type LeftOutRow,
  type TableCells,
  type TableColumn,
  type TableRow,
  type TableView,
} from "@/lib/paper-table";

const BLANKS: CellKind[] = ["not_stated", "unverified", "empty"];

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function Check({ checked, onChange, label, count }: { checked: boolean; onChange: (checked: boolean) => void; label: string; count?: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-body hover:bg-subtle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="tabular-nums text-xs text-mute">{count.toLocaleString()}</span> : null}
    </label>
  );
}

function DialogFrame({ title, onClose, onSubmit, onClear, children }: { title: string; onClose: () => void; onSubmit: () => void; onClear: () => void; children: React.ReactNode }) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Modal onClose={onClose} zIndexClassName="z-[70]">
      <form onSubmit={submit} className="flex max-h-[85dvh] w-[min(420px,92vw)] flex-col rounded-xl border border-hairline bg-surface p-5 shadow-overlay">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" onClick={onClear} className={buttonClass("ghost", "sm")}>
            Clear
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
            <button type="submit" className={buttonClass("primary", "sm")}>
              Show
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** The paper column's filter: words in the title, and a range of years. */
export function PaperFilterDialog({ view, onApply, onClose }: { view: TableView; onApply: (change: Pick<TableView, "title" | "yearFrom" | "yearTo">) => void; onClose: () => void }) {
  const [title, setTitle] = useState(view.title ?? "");
  const [from, setFrom] = useState(view.yearFrom != null ? String(view.yearFrom) : "");
  const [to, setTo] = useState(view.yearTo != null ? String(view.yearTo) : "");
  return (
    <DialogFrame
      title="Filter the papers"
      onClose={onClose}
      onClear={() => onApply({ title: "", yearFrom: null, yearTo: null })}
      onSubmit={() => onApply({ title: title.trim(), yearFrom: numberOrNull(from), yearTo: numberOrNull(to) })}
    >
      <label className="block">
        <span className={labelClass}>Title has</span>
        <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={`mt-1.5 ${fieldClass}`} placeholder="e.g. writing" />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>From year</span>
          <input inputMode="numeric" value={from} onChange={(event) => setFrom(event.target.value)} maxLength={4} className={`mt-1.5 ${fieldClass}`} placeholder="e.g. 2018" />
        </label>
        <label className="block">
          <span className={labelClass}>To year</span>
          <input inputMode="numeric" value={to} onChange={(event) => setTo(event.target.value)} maxLength={4} className={`mt-1.5 ${fieldClass}`} placeholder="e.g. 2025" />
        </label>
      </div>
    </DialogFrame>
  );
}

/**
 * One column's filter. A short-label or yes/no column offers its labels with
 * their counts; a number column a range; a words column the words a value has.
 * Each also offers the cells without a value: Not stated, Not confirmed, Not
 * read yet.
 */
export function ColumnFilterDialog({
  column,
  rows,
  cells,
  filter,
  onApply,
  onClose,
}: {
  column: TableColumn;
  rows: TableRow[];
  cells: TableCells;
  filter: ColumnFilter | undefined;
  onApply: (filter: ColumnFilter | null) => void;
  onClose: () => void;
}) {
  const counts = useMemo(() => columnCounts(rows, column, cells), [cells, column, rows]);
  const labelled = column.kind === "category" || column.kind === "yesno";
  const [labels, setLabels] = useState<Set<string>>(() => new Set((filter?.labels ?? []).map(labelKey)));
  const [text, setText] = useState(filter?.text ?? "");
  const [min, setMin] = useState(filter?.min != null ? String(filter.min) : "");
  const [max, setMax] = useState(filter?.max != null ? String(filter.max) : "");
  const [kinds, setKinds] = useState<Set<CellKind>>(() => new Set(filter?.show ?? []));

  function toggle<T>(set: Set<T>, value: T, on: boolean): Set<T> {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  }

  function apply() {
    const chosen = counts.labels.filter((entry) => labels.has(entry.key)).map((entry) => entry.label);
    const range = { min: numberOrNull(min), max: numberOrNull(max) };
    const words = text.trim();
    const valueTest = labelled ? chosen.length > 0 : column.kind === "number" ? range.min != null || range.max != null : Boolean(words);
    const show = [...new Set<CellKind>([...(valueTest ? (["found"] as CellKind[]) : []), ...kinds])];
    if (show.length === 0) return onApply(null);
    onApply({
      show,
      ...(labelled && chosen.length ? { labels: chosen } : {}),
      ...(column.kind === "number" ? range : {}),
      ...(!labelled && column.kind !== "number" && words ? { text: words } : {}),
    });
  }

  return (
    <DialogFrame title={`Filter: ${column.name}`} onClose={onClose} onClear={() => onApply(null)} onSubmit={apply}>
      {labelled ? (
        <fieldset>
          <legend className={labelClass}>Show the studies that say</legend>
          <div className="mt-1.5 grid gap-0.5">
            {counts.labels.length === 0 ? <p className={hintClass}>No values yet.</p> : null}
            {counts.labels.map((entry) => (
              <Check key={entry.key} label={entry.label} count={entry.count} checked={labels.has(entry.key)} onChange={(on) => setLabels((current) => toggle(current, entry.key, on))} />
            ))}
          </div>
        </fieldset>
      ) : column.kind === "number" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>At least</span>
            <input autoFocus inputMode="decimal" value={min} onChange={(event) => setMin(event.target.value)} className={`mt-1.5 ${fieldClass}`} />
          </label>
          <label className="block">
            <span className={labelClass}>At most</span>
            <input inputMode="decimal" value={max} onChange={(event) => setMax(event.target.value)} className={`mt-1.5 ${fieldClass}`} />
          </label>
          <p className={`col-span-2 ${hintClass} !mt-0`}>The number a value starts with: &ldquo;30 students&rdquo; is 30.</p>
        </div>
      ) : (
        <label className="block">
          <span className={labelClass}>Value has</span>
          <input autoFocus value={text} onChange={(event) => setText(event.target.value)} maxLength={120} className={`mt-1.5 ${fieldClass}`} placeholder="e.g. interview" />
        </label>
      )}
      <fieldset className="mt-4">
        <legend className={labelClass}>{labelled ? "And those that" : "Also show"}</legend>
        <div className="mt-1.5 grid gap-0.5">
          {labelled ? null : (
            <Check label={`${CELL_KIND_WORDS.found} (any)`} count={counts.kinds.found} checked={kinds.has("found")} onChange={(on) => setKinds((current) => toggle(current, "found", on))} />
          )}
          {BLANKS.filter((kind) => counts.kinds[kind] > 0 || kinds.has(kind)).map((kind) => (
            <Check key={kind} label={CELL_KIND_WORDS[kind]} count={counts.kinds[kind]} checked={kinds.has(kind)} onChange={(on) => setKinds((current) => toggle(current, kind, on))} />
          ))}
        </div>
      </fieldset>
    </DialogFrame>
  );
}

/** What the view does, as chips; each clears its own part. */
export function ViewChips({ chips, onClear, onClearAll }: { chips: Array<{ key: string; label: string }>; onClear: (key: string) => void; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters and sorting">
      {chips.map((chip) => (
        <span key={chip.key} className={chipClass("neutral", "max-w-full py-1 pl-2.5 pr-1")}>
          <span className="min-w-0 truncate">{chip.label}</span>
          <button type="button" onClick={() => onClear(chip.key)} aria-label={`Clear ${chip.label}`} className="rounded-full p-0.5 text-mute hover:bg-surface hover:text-ink">
            <CloseIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
      {chips.length > 1 ? (
        <button type="button" onClick={onClearAll} className="px-1.5 text-xs font-medium text-mute hover:text-ink hover:underline">
          Clear all
        </button>
      ) : null}
    </div>
  );
}

/** Leaving one paper out, with the reader's reason. */
export function LeaveOutDialog({ row, busy, onLeave, onClose }: { row: TableRow; busy: boolean; onLeave: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal onClose={() => (busy ? undefined : onClose())} zIndexClassName="z-[70]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onLeave(reason.trim());
        }}
        className="w-[min(460px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay"
      >
        <h2 className="text-base font-semibold text-ink">Leave this paper out?</h2>
        <p className="mt-2 line-clamp-3 text-sm font-medium leading-6 text-ink">{row.title}</p>
        <label className="mt-4 block">
          <span className={labelClass}>Reason (optional)</span>
          <input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} className={`mt-1.5 ${fieldClass}`} placeholder="e.g. Not an empirical study" />
        </label>
        <p className={hintClass}>
          It is no longer shown, read or downloaded with this table. What was read is kept, and Left out, below the table, puts it back.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={buttonClass("secondary", "sm")}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>
            Leave out
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The papers left out of the table, each with its reason and, from a yes/no column, the sentence that decided it. */
export function LeftOutList({
  rows,
  columns,
  cells,
  busy,
  onPutBack,
}: {
  rows: LeftOutRow[];
  columns: TableColumn[];
  cells: TableCells;
  busy: boolean;
  onPutBack: (paperIds: string[]) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="group rounded-xl border border-hairline bg-surface" data-left-out="">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink">
        <span>
          Left out <span className="tabular-nums text-mute">{rows.length.toLocaleString()}</span>
        </span>
        <span className="text-xs font-normal text-mute group-open:hidden">Show</span>
      </summary>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {rows.map((row) => {
          const cell = row.columnId ? cells[cellKey(row.paperId, row.columnId)] : undefined;
          const reason = leftOutReason(row, columns);
          return (
            <li key={row.paperId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <PaperLink paper={{ paperId: row.paperId }} className="line-clamp-2 text-sm font-medium leading-6 text-ink hover:underline">
                  {row.title}
                </PaperLink>
                <p className="text-[13px] leading-5 text-mute">
                  {[row.year && row.year !== "Unknown" ? row.year : null, reason || "No reason given"].filter(Boolean).join(" · ")}
                </p>
                {cell?.status === "found" && cell.quote ? (
                  <blockquote className="mt-1 line-clamp-3 border-l-2 border-hairline-strong pl-3 text-[13px] leading-5 text-body">{cell.quote}</blockquote>
                ) : null}
              </div>
              <button type="button" disabled={busy} onClick={() => onPutBack([row.paperId])} className={buttonClass("secondary", "sm", "shrink-0")}>
                <UndoIcon className="h-3.5 w-3.5" />
                Put back
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > 1 ? (
        <div className="flex justify-end border-t border-hairline px-4 py-2.5">
          <button type="button" disabled={busy} onClick={() => onPutBack(rows.map((row) => row.paperId))} className={buttonClass("ghost", "sm")}>
            Put all back
          </button>
        </div>
      ) : null}
    </details>
  );
}

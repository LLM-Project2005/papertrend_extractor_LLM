"use client";

/*
 * The paper table's column picker (docs/42), in the manner of an analytics
 * dashboard's: every ready-made column by group, and the reader's own, each
 * with a tick. Ticking shows a column (and reads it, if it has not been read);
 * clearing hides it and keeps what was read. Nothing changes until Apply.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useMemo, useState } from "react";
import { SearchIcon } from "@/components/ui/Icons";
import Modal from "@/components/ui/Modal";
import { buttonClass, fieldClass } from "@/components/ui/controls";
import { MAX_COLUMNS, columnChoiceKey, type TableColumn } from "@/lib/paper-table";
import { COLUMN_PRESET_GROUPS, type ColumnPreset } from "@/lib/paper-table-presets";

const KIND_LABEL: Record<TableColumn["kind"], string> = { text: "Words", number: "Number", category: "Label", yesno: "Yes or no" };

function Choice({
  checked,
  disabled,
  name,
  description,
  kind,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  name: string;
  description: string;
  kind: TableColumn["kind"];
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex gap-3 rounded-lg px-2.5 py-2 hover:bg-subtle ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 flex-none" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-ink">{name}</span>
          <span className="text-[11px] uppercase tracking-wide text-mute">{KIND_LABEL[kind]}</span>
        </span>
        {description ? <span className="mt-0.5 block text-[13px] leading-5 text-mute">{description}</span> : null}
      </span>
    </label>
  );
}

export default function ColumnPicker({
  columns,
  studies,
  busy,
  onApply,
  onAddOwn,
  onClose,
}: {
  columns: TableColumn[];
  studies: number;
  busy: boolean;
  onApply: (chosen: Set<string>, presets: ColumnPreset[]) => void;
  onAddOwn: () => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(columns.filter((column) => !column.hidden).map(columnChoiceKey)));
  const [search, setSearch] = useState("");
  const have = useMemo(() => new Set(columns.map(columnChoiceKey)), [columns]);
  const own = columns.filter((column) => columnChoiceKey(column).startsWith("column:"));
  const query = search.trim().toLowerCase();
  const matches = (name: string, description: string) => !query || `${name} ${description}`.toLowerCase().includes(query);
  const presets = COLUMN_PRESET_GROUPS.flatMap((group) => group.columns);
  const toRead = presets.filter((preset) => chosen.has(`preset:${preset.key}`) && !have.has(`preset:${preset.key}`)).length;
  const room = MAX_COLUMNS - columns.length;

  function toggle(key: string, checked: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <Modal onClose={() => (busy ? undefined : onClose())} zIndexClassName="z-[70]">
      <div className="flex max-h-[86vh] w-[min(880px,94vw)] flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-overlay">
        <div className="border-b border-hairline p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Columns</h2>
            <span className="text-[13px] text-mute">{chosen.size} shown</span>
          </div>
          <label className="relative mt-3 block">
            <span className="sr-only">Find a column</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a column" className={`${fieldClass} pl-9`} />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {COLUMN_PRESET_GROUPS.map((group) => {
            const shown = group.columns.filter((preset) => matches(preset.name, preset.instruction));
            if (shown.length === 0) return null;
            return (
              <section key={group.id} className="mb-3">
                <h3 className="sticky top-0 z-10 bg-surface px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-mute">{group.label}</h3>
                <div className="grid gap-x-3 sm:grid-cols-2">
                  {shown.map((preset) => {
                    const key = `preset:${preset.key}`;
                    return (
                      <Choice
                        key={key}
                        checked={chosen.has(key)}
                        disabled={!have.has(key) && !chosen.has(key) && toRead >= room}
                        name={preset.name}
                        description={preset.instruction}
                        kind={preset.kind}
                        onChange={(checked) => toggle(key, checked)}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
          {own.some((column) => matches(column.name, column.instruction)) ? (
            <section className="mb-3">
              <h3 className="sticky top-0 z-10 bg-surface px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-mute">Your columns</h3>
              <div className="grid gap-x-3 sm:grid-cols-2">
                {own
                  .filter((column) => matches(column.name, column.instruction))
                  .map((column) => {
                    const key = columnChoiceKey(column);
                    return (
                      <Choice
                        key={key}
                        checked={chosen.has(key)}
                        disabled={false}
                        name={column.name}
                        description={column.instruction}
                        kind={column.kind}
                        onChange={(checked) => toggle(key, checked)}
                      />
                    );
                  })}
              </div>
            </section>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline p-4 sm:px-5">
          <div className="min-w-0 text-[13px] leading-5 text-mute">
            {toRead > 0
              ? `${toRead} new ${toRead === 1 ? "column" : "columns"} will be read for ${studies.toLocaleString()} ${studies === 1 ? "study" : "studies"}.`
              : "Showing and hiding reads nothing; hidden columns keep what was read."}
            <button type="button" disabled={busy} onClick={onAddOwn} className="ml-1 font-medium text-ink underline-offset-2 hover:underline">
              Write your own column
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onClose} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
            <button type="button" disabled={busy || chosen.size === 0} onClick={() => onApply(chosen, presets)} className={buttonClass("primary", "sm")}>
              {toRead > 0 ? "Apply and read" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

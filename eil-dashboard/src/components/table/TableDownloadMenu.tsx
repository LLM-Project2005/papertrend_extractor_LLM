"use client";

/*
 * The paper table's Download button (docs/42): one button, and a menu of the
 * formats: CSV for any tool, Excel with a sheet of sources, and a picture of
 * the chart and table for a slide or a report. Each file holds the columns
 * shown.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, DownloadIcon } from "@/components/ui/Icons";
import { buttonClass, menuItemClass, menuPanelClass } from "@/components/ui/controls";

export type DownloadFormat = "csv" | "xlsx" | "png";

const FORMATS: Array<{ format: DownloadFormat; label: string; detail: string }> = [
  { format: "csv", label: "CSV", detail: "Values and their sentences, for any spreadsheet or tool" },
  { format: "xlsx", label: "Excel (.xlsx)", detail: "The table, numbers as numbers, and a sheet of sources" },
  { format: "png", label: "Image (.png)", detail: "The chart and the table, for a slide or a report" },
];

export default function TableDownloadMenu({ disabled, onDownload }: { disabled: boolean; onDownload: (format: DownloadFormat) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<DownloadFormat | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        disabled={disabled || working !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={buttonClass("secondary", "sm")}
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        {working ? "Preparing…" : "Download"}
        <ChevronDownIcon className="h-3 w-3" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Download as"
          className={`${menuPanelClass} absolute right-0 top-full z-30 mt-1.5 w-[min(320px,86vw)]`}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const index = items.current.findIndex((item) => item === document.activeElement);
            const step = event.key === "ArrowDown" ? 1 : -1;
            items.current[(index + step + FORMATS.length) % FORMATS.length]?.focus();
          }}
        >
          {FORMATS.map((entry, index) => (
            <button
              key={entry.format}
              ref={(node) => {
                items.current[index] = node;
              }}
              type="button"
              role="menuitem"
              className={menuItemClass(false, "flex-col items-start gap-0.5")}
              onClick={async () => {
                setOpen(false);
                setWorking(entry.format);
                try {
                  await onDownload(entry.format);
                } finally {
                  setWorking(null);
                }
              }}
            >
              <span className="font-medium text-ink">{entry.label}</span>
              <span className="text-[13px] leading-5 text-mute">{entry.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

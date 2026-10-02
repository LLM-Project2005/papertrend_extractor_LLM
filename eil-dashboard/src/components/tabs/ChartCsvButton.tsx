"use client";

// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { DownloadIcon } from "@/components/ui/Icons";
import { csvFileName, toCsv, type ChartCsv } from "@/lib/chart-csv";

/** Downloads one chart's data as CSV (docs/32, 4.3). */
export default function ChartCsvButton({
  csv,
  className = "",
  label = "Download CSV",
}: {
  csv: ChartCsv;
  className?: string;
  label?: string;
}) {
  if (csv.rows.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([toCsv(csv.header, csv.rows)], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = csvFileName(csv.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }}
      className={`inline-flex min-h-9 flex-none items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-[#a3a3a3] dark:hover:text-white ${className}`}
    >
      <DownloadIcon className="h-3.5 w-3.5" />
      {label}
      <span className="sr-only">: {csv.name}</span>
    </button>
  );
}

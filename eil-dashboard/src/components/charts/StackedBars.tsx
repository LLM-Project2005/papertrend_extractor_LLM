"use client";

/*
 * Parts of a whole, end to end in one bar per row (docs/38): the words in
 * each section of each paper. At most eight parts take colours; the bar's
 * total is printed at its end, and each part's value is in its hover label
 * and the table view.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useState } from "react";
import { AxisTicks, Gridlines, Legend, ShowAll } from "@/components/charts/parts";
import { categoricalColor } from "@/lib/chart-palette";
import { formatNumber, niceAxis, position } from "@/lib/charts/scale";

export interface StackRow {
  key: string;
  label: string;
  parts: number[];
}

export default function StackedBars({ series, rows, unit, initialRows = 12 }: { series: string[]; rows: StackRow[]; unit?: string; initialRows?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0 || series.length === 0) return null;
  const shown = rows.slice(0, expanded ? rows.length : initialRows);
  const totals = shown.map((row) => row.parts.reduce((sum, part) => sum + (Number.isFinite(part) ? part : 0), 0));
  const axis = niceAxis(Math.max(...totals), { integer: true });
  return (
    <div data-chart="stacked">
      <p className="mb-2 text-xs font-medium text-body">{unit ? `${unit.replace(/^./, (c) => c.toUpperCase())}, by part` : "By part"}</p>
      <div className="mb-3">
        <Legend items={series.map((name, index) => ({ label: name, color: categoricalColor(index) }))} />
      </div>
      <ul className="space-y-2">
        {shown.map((row, rowIndex) => {
          const total = totals[rowIndex];
          const spoken = series.map((name, index) => `${name} ${formatNumber(row.parts[index] ?? 0)}`).join(", ");
          return (
            <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4.5rem]">
              <span className="col-span-2 line-clamp-2 min-w-0 break-words text-sm leading-5 text-ink sm:col-span-1" title={row.label}>
                {row.label}
              </span>
              <div className="relative h-5" title={`${row.label}: ${spoken}`} aria-label={`${row.label}: ${spoken}; ${formatNumber(total)} in all`}>
                <Gridlines axis={axis} />
                <span className="absolute inset-y-1 left-0 flex overflow-hidden rounded-r-[4px] rounded-l-[1px]" style={{ width: `${position(total, axis)}%` }}>
                  {row.parts.map((part, index) =>
                    part > 0 ? (
                      <span
                        key={series[index] ?? index}
                        className="h-full border-r-2 border-surface last:border-r-0"
                        style={{ width: `${(part / total) * 100}%`, backgroundColor: categoricalColor(index) }}
                      />
                    ) : null
                  )}
                </span>
              </div>
              <span className="text-right text-xs tabular-nums text-body">{formatNumber(total)}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_4.5rem] gap-x-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4.5rem]">
        <span className="hidden sm:block" />
        <AxisTicks axis={axis} />
        <span />
      </div>
      <ShowAll shown={shown.length} total={rows.length} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </div>
  );
}

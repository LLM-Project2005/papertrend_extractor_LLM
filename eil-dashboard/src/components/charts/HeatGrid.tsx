"use client";

/*
 * Papers for each pair of values, as a grid (docs/38): methods by theme,
 * research areas by year. One hue, darker for more papers, with its scale
 * shown; every cell prints its count and opens its papers; each row ends with
 * its own total, so a reader can tell a big theme from a busy cell.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { formatNumber } from "@/lib/charts/scale";
import type { PaperId } from "@/types/database";

export interface HeatGridProps {
  rowLabel: string;
  colLabel: string;
  rows: string[];
  cols: string[];
  values: number[][];
  paperIds: PaperId[][][];
  /** Papers behind each row, for its total. */
  rowTotals?: number[];
  /** Cells a finding is about: [row, col, "strong" | "absent"]. */
  marks?: Array<[number, number, "strong" | "absent"]>;
  onOpen?: (paperIds: PaperId[], label: string) => void;
}

/**
 * The accent laid over the panel, more for more papers. Drawn with the theme's
 * own colour variables, so it needs no theme in JavaScript. Black text clears
 * 4.8:1 on every light cell (#2563eb at most 90% over #ffffff). On the dark
 * page (#60a5fa over #0a0a0a) white text clears 4.6:1 below 70% and black
 * 4.5:1 from there (tests/contrast-all.test.ts).
 */
export const DARK_TEXT_FROM = 0.7;
function alphaOf(strength: number): number {
  return 0.1 + strength * 0.8;
}

function cellStyle(strength: number): { background: string; text: string } {
  const alpha = alphaOf(strength);
  return { background: `rgb(var(--accent) / ${alpha.toFixed(3)})`, text: alpha < DARK_TEXT_FROM ? "text-black dark:text-white" : "text-black" };
}

export default function HeatGrid({ rowLabel, colLabel, rows, cols, values, paperIds, rowTotals, marks = [], onOpen }: HeatGridProps) {
  if (rows.length === 0 || cols.length === 0) return null;
  const max = Math.max(...values.flat(), 1);
  const mark = new Map(marks.map(([row, col, kind]) => [`${row}:${col}`, kind]));
  return (
    <div data-chart="grid">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[26rem] border-separate border-spacing-1 text-xs sm:min-w-[34rem]">
          <caption className="sr-only">
            Papers for each {rowLabel.toLowerCase()} and {colLabel.toLowerCase()}. A darker cell has more papers.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-28 pb-1 text-left align-bottom font-medium text-body sm:w-48">
                {rowLabel} <span className="font-normal text-mute">by {colLabel.toLowerCase()}</span>
              </th>
              {cols.map((col) => (
                <th key={col} scope="col" className="max-w-[7rem] px-1 pb-1 text-left align-bottom font-medium leading-4 text-body">
                  <span className="line-clamp-3" title={col}>{col}</span>
                </th>
              ))}
              {rowTotals ? (
                <th scope="col" className="px-1 pb-1 text-right align-bottom font-medium text-mute">
                  All
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row}>
                <th scope="row" className="pr-2 text-left font-normal leading-4 text-ink">
                  <span className="line-clamp-3 sm:line-clamp-2" title={row}>{row}</span>
                </th>
                {cols.map((col, c) => {
                  const value = values[r]?.[c] ?? 0;
                  const kind = mark.get(`${r}:${c}`);
                  const cell = value === 0 ? null : cellStyle(value / max);
                  return (
                    <td key={col} className="p-0">
                      <button
                        type="button"
                        disabled={value === 0 || !onOpen}
                        onClick={() => onOpen?.(paperIds[r]?.[c] ?? [], `${row} with ${col}`)}
                        aria-label={`${row} with ${col}: ${value} paper${value === 1 ? "" : "s"}${kind === "strong" ? ", a strong pairing" : kind === "absent" ? ", none where some were expected" : ""}`}
                        className={`flex h-9 w-full min-w-[3rem] items-center justify-center rounded-md tabular-nums transition-transform enabled:hover:scale-[1.04] ${cell ? cell.text : ""} ${
                          kind === "strong"
                            ? "ring-2 ring-ink ring-offset-1 ring-offset-surface"
                            : kind === "absent"
                              ? "border border-dashed border-amber-600 dark:border-amber-400"
                              : value === 0
                                ? "border border-hairline text-mute"
                                : ""
                        }`}
                        style={{ background: cell ? cell.background : "transparent" }}
                      >
                        {value}
                      </button>
                    </td>
                  );
                })}
                {rowTotals ? <td className="px-1 text-right tabular-nums text-mute">{formatNumber(rowTotals[r] ?? 0)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-body">
        <span className="inline-flex items-center gap-1.5" aria-hidden>
          <span className="tabular-nums text-mute">1</span>
          <span className="inline-flex overflow-hidden rounded-sm">
            {[0.15, 0.4, 0.7, 1].map((strength) => (
              <span key={strength} className="h-3 w-4" style={{ background: cellStyle(strength).background }} />
            ))}
          </span>
          <span className="tabular-nums text-mute">{formatNumber(max)} papers</span>
        </span>
        {marks.some(([, , kind]) => kind === "strong") ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-ink" /> Together far more often than chance
          </span>
        ) : null}
        {marks.some(([, , kind]) => kind === "absent") ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-amber-600 dark:border-amber-400" /> None, where about 3 were expected
          </span>
        ) : null}
        {cols.length > 2 ? <span className="text-mute sm:hidden">Swipe sideways to see all {cols.length} columns.</span> : null}
      </div>
    </div>
  );
}

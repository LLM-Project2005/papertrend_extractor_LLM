"use client";

// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { readableTextOn } from "@/lib/contrast";

/**
 * A heatmap: row labels, column labels, and a count in each cell.
 *
 * Each cell fills its column, so a long column heading (a research area's
 * name) sits over its cells instead of beside them (2026-10-24 review: the
 * co-occurrence grid's headings did not line up). A grid of mostly zeros can
 * leave them blank, so the counts that matter stand out; a row can carry its
 * theme's colour as a dot beside its name.
 */

interface Props {
  rows: string[];
  cols: string[];
  values: number[][]; // values[rowIdx][colIdx]
  title?: string;
  colorScale?: [string, string]; // [low, high] hex colours
  /** A dot beside each row's name: its theme's colour. */
  rowColors?: string[];
  /** Zero cells drawn empty, without a "0". */
  hideZeros?: boolean;
  /** Every column this wide (long headings wrap over it); years keep 2.5rem. */
  columnWidth?: string;
}

function interpolate(low: string, high: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16),
    ];
  };
  const [lr, lg, lb] = parse(low);
  const [hr, hg, hb] = parse(high);
  const r = Math.round(lr + (hr - lr) * t);
  const g = Math.round(lg + (hg - lg) * t);
  const b = Math.round(lb + (hb - lb) * t);
  return `rgb(${r},${g},${b})`;
}

/** Dark or light text, whichever has more contrast on this cell; the scale can
 * run either way (light to dark on a light page, dark to light on a dark one).
 * A gamma-blind luminance cut-off put white on mid greys at 3.2:1 (A11Y-9). */
function textOn(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  // Black or white: one of the two clears 4.5:1 on any colour.
  return readableTextOn(hex, ["#000000", "#ffffff"]);
}

export default function Heatmap({
  rows,
  cols,
  values,
  title,
  colorScale = ["#fff7ec", "#cc4c02"],
  rowColors,
  hideZeros = false,
  columnWidth = "2.5rem",
}: Props) {
  const flat = values.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = max - min || 1;

  return (
    <div>
      {title && (
        <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-[#ececec]">{title}</h4>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-1 dark:bg-[#050505]" />
              {cols.map((c) => (
                <th
                  key={c}
                  title={c}
                  style={{ width: columnWidth, minWidth: columnWidth, maxWidth: columnWidth }}
                  className="p-1 align-bottom text-center font-medium leading-4 text-slate-500 dark:text-[#a3a3a3]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                {/* Sticky and truncated on a phone, so the year columns scroll
                    under the names instead of being pushed off the card. */}
                <td
                  title={r}
                  className="sticky left-0 z-10 max-w-[9rem] truncate whitespace-nowrap bg-white pr-2 text-right font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0] sm:max-w-none"
                >
                  {rowColors?.[ri] ? (
                    <span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: rowColors[ri] }} />
                  ) : null}
                  {r}
                </td>
                {cols.map((c, ci) => {
                  const v = values[ri]?.[ci] ?? 0;
                  const t = (v - min) / range;
                  return (
                    <td
                      key={c}
                      className="p-0"
                      title={`${r} × ${c}: ${v}`}
                    >
                      <div
                        className="flex h-8 w-full items-center justify-center border border-white/50 text-[10px] font-medium tabular-nums dark:border-black/50"
                        style={{
                          backgroundColor: interpolate(colorScale[0], colorScale[1], t),
                          color: textOn(interpolate(colorScale[0], colorScale[1], t)),
                        }}
                      >
                        {hideZeros && v === 0 ? "" : v}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

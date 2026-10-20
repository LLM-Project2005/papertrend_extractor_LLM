"use client";

/*
 * Horizontal bars, the chart most views are (docs/38).
 *
 * A bar is measured on an axis that starts at zero and ends at a rounded
 * value printed under it - never against the largest bar, which made three
 * values of 1 three full-width bars. Counts of papers no larger than
 * UNIT_MAX are drawn one square per paper instead: one paper is one square in
 * every chart, and each square opens its paper. A chart of papers can be
 * switched to shares of a stated whole.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useState } from "react";
import { ChartNote, Gridlines, Legend, ModeSwitch, ShowAll, AxisTicks, type LegendItem, type ValueMode } from "@/components/charts/parts";
import {
  drawsAsUnits,
  formatNumber,
  formatPercent,
  niceAxis,
  paperAxisLabel,
  papers as paperWord,
  position,
  sharePercent,
  varies,
} from "@/lib/charts/scale";
import type { PaperId } from "@/types/database";

export interface BarDatum {
  key: string;
  label: string;
  /** A second line under the label: a year, "2.1 times as often as chance". */
  sub?: string;
  value: number;
  paperIds?: PaperId[];
  /** The bar's colour when bars are told apart (a paper's research area). */
  color?: string;
  /** The value a question asks about, drawn in the accent; the rest in grey. */
  emphasis?: boolean;
}

export interface BarsProps {
  rows: BarDatum[];
  /** papers: each value counts papers. value: a quantity read or counted (words, participants). */
  measure: "papers" | "value";
  /** papers: the papers the counts are out of; it turns on the Papers | % switch. */
  total?: number;
  /** value: what a bar measures, plural, for the axis ("words", "participants"). */
  unit?: string;
  /** Replaces the axis title. */
  axisLabel?: string;
  onOpen?: (paperIds: PaperId[], label: string) => void;
  /** Paper titles, for a square's label. */
  paperTitles?: Map<string, string>;
  /** Rows shown before "Show all". */
  initialRows?: number;
  legend?: LegendItem[];
  defaultMode?: ValueMode;
}

const MAX_ROWS = 100;

export default function Bars({
  rows,
  measure,
  total,
  unit,
  axisLabel,
  onOpen,
  paperTitles,
  initialRows = 10,
  legend,
  defaultMode = "count",
}: BarsProps) {
  const canShare = measure === "papers" && (total ?? 0) >= 2;
  const [mode, setMode] = useState<ValueMode>(canShare ? defaultMode : "count");
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const percent = canShare && mode === "percent";
  const shown = rows.slice(0, expanded ? MAX_ROWS : initialRows);
  const valueOf = (row: BarDatum) => (percent ? sharePercent(row.value, total as number) : row.value);
  const values = rows.map(valueOf);
  const units = !percent && drawsAsUnits(rows.map((row) => row.value), measure);
  const axis = niceAxis(Math.max(...shown.map(valueOf)), { integer: measure === "papers" && !percent, cap: percent ? 100 : undefined });
  const emphasised = rows.some((row) => row.emphasis);
  const title = axisLabel ?? (measure === "papers" ? paperAxisLabel(total, percent ? "percent" : "count") : unit ? unit.replace(/^./, (c) => c.toUpperCase()) : "");
  const describe = (row: BarDatum) =>
    measure === "papers"
      ? `${paperWord(row.value)}${total ? ` of ${formatNumber(total)} (${formatPercent(sharePercent(row.value, total))})` : ""}`
      : `${formatNumber(row.value)}${unit ? ` ${unit}` : ""}`;
  // One quantity, one fill, from the theme's own tokens; only a colour that means something (a research area) is written in.
  const fill = (row: BarDatum): { className: string; style?: React.CSSProperties } =>
    row.color ? { className: "", style: { backgroundColor: row.color } } : { className: emphasised && !row.emphasis ? "bg-mute/45" : "bg-accent" };

  return (
    <div data-chart="bars" data-units={units || undefined}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {title ? <p className="text-xs font-medium text-body">{title}</p> : <span />}
        {canShare ? <ModeSwitch mode={mode} onChange={setMode} /> : null}
      </div>
      {legend && legend.length > 0 ? (
        <div className="mb-3">
          <Legend items={legend} />
        </div>
      ) : null}
      {!varies(values) && rows.length >= 2 ? (
        <ChartNote>
          All {formatNumber(rows.length)} have the same value, {percent ? formatPercent(values[0]) : describe(rows[0])}, so none stands out.
        </ChartNote>
      ) : null}
      <ul className="space-y-2">
        {shown.map((row) => {
          const value = valueOf(row);
          const ids = row.paperIds ?? [];
          const label = (
            <>
              <span className="line-clamp-2 break-words" title={row.label}>
                {row.label}
              </span>
              {row.sub ? <span className="block text-xs leading-4 text-mute">{row.sub}</span> : null}
            </>
          );
          return (
            <li
              key={row.key}
              className={`grid items-center gap-x-3 gap-y-1 ${units ? "grid-cols-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)_4.5rem] sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4.5rem]"}`}
            >
              <div className={`min-w-0 text-sm leading-5 text-ink ${units ? "" : "col-span-2 sm:col-span-1"}`}>
                {onOpen && ids.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpen(ids, row.label)}
                    aria-label={`${row.label}: ${describe(row)}. Show the papers.`}
                    className="block w-full rounded text-left underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {label}
                  </button>
                ) : (
                  <div>{label}</div>
                )}
              </div>
              {units ? (
                <div className="flex min-h-5 flex-wrap items-center gap-[3px]" title={`${row.label}: ${describe(row)}`}>
                  {Array.from({ length: row.value }, (_, index) => {
                    const id = ids[index];
                    const paperTitle = id !== undefined ? paperTitles?.get(String(id)) : undefined;
                    const square = (
                      <span data-bar className={`block h-3.5 w-3.5 rounded-[3px] ${fill(row).className}`} style={fill(row).style} aria-hidden />
                    );
                    return onOpen && id !== undefined ? (
                      <button
                        key={index}
                        type="button"
                        onClick={() => onOpen([id], paperTitle ?? row.label)}
                        title={paperTitle ?? `${row.label}: paper ${index + 1}`}
                        aria-label={paperTitle ? `Open ${paperTitle}` : `${row.label}: paper ${index + 1}`}
                        className="rounded-[3px] transition-transform hover:scale-125 focus-visible:scale-125"
                      >
                        {square}
                      </button>
                    ) : (
                      <span key={index}>{square}</span>
                    );
                  })}
                  <span className="ml-1.5 text-xs tabular-nums text-body">{formatNumber(row.value)}</span>
                </div>
              ) : (
                <div className="relative h-5" title={`${row.label}: ${describe(row)}`} aria-hidden>
                  <Gridlines axis={axis} />
                  <span
                    data-bar
                    className={`absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-r-[4px] rounded-l-[1px] ${fill(row).className}`}
                    style={{ width: `${position(value, axis)}%`, minWidth: value > 0 ? 2 : 0, ...fill(row).style }}
                  />
                </div>
              )}
              {units ? null : (
                <span className="text-right text-xs tabular-nums text-body">{percent ? formatPercent(value) : formatNumber(value)}</span>
              )}
            </li>
          );
        })}
      </ul>
      {units ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-mute">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-accent" aria-hidden /> One square is one paper
          {onOpen ? "; select one to open it" : ""}
        </p>
      ) : (
        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_4.5rem] gap-x-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4.5rem]">
          <span className="hidden sm:block" />
          <AxisTicks axis={axis} percent={percent} />
          <span />
        </div>
      )}
      <ShowAll shown={shown.length} total={Math.min(rows.length, MAX_ROWS)} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
      {rows.length > MAX_ROWS && expanded ? (
        <p className="mt-1 text-xs text-mute">
          The first {MAX_ROWS} of {formatNumber(rows.length)} are drawn; the CSV has every one.
        </p>
      ) : null}
    </div>
  );
}

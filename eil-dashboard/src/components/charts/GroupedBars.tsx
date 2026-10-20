"use client";

/*
 * Two or more groups side by side for each row (docs/38): earlier papers
 * against later ones, a research area against the rest, the papers on a
 * subject against all of them, or a paper's own figures (pre-test and
 * post-test).
 *
 * Groups of papers differ in size, so their shares are compared, not their
 * counts: the default is percent, each value says what it is a share of, and
 * the switch shows the counts. The old chart drew two dots on an unlabelled
 * line with "Share of papers, %" in the corner.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useState } from "react";
import { AxisTicks, Gridlines, Legend, ModeSwitch, ShowAll, type ValueMode } from "@/components/charts/parts";
import { formatNumber, formatPercent, niceAxis, position, sharePercent } from "@/lib/charts/scale";
import type { PaperId } from "@/types/database";

export interface GroupSeries {
  key: string;
  label: string;
  color: string;
  /** Papers in the group, when the same for every row ("2011–2021", 17 papers). */
  of?: number;
}

export interface GroupRow {
  key: string;
  label: string;
  sub?: string;
  /** "gaining", "losing": a change that passes the shift rules. */
  tag?: string;
  /** The row the question asked about, named in bold. */
  emphasis?: boolean;
  /** One value per series: papers (counts) or a quantity. */
  values: Array<number | null>;
  /** papers: each series' whole for this row, when it differs from the series' own. */
  of?: Array<number | undefined>;
  paperIds?: PaperId[];
}

export interface GroupedBarsProps {
  series: GroupSeries[];
  rows: GroupRow[];
  /** papers: values are counts of papers out of a whole; value: quantities. percentOnly: shares, from data that kept no counts. */
  measure: "papers" | "value" | "percentOnly";
  unit?: string;
  onOpen?: (paperIds: PaperId[], label: string) => void;
  defaultMode?: ValueMode;
  initialRows?: number;
}

const TAG_TONE: Record<string, string> = {
  gaining: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  losing: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
};

export default function GroupedBars({ series, rows, measure, unit, onOpen, defaultMode = "percent", initialRows = 8 }: GroupedBarsProps) {
  const canSwitch = measure === "papers";
  const [mode, setMode] = useState<ValueMode>(measure === "percentOnly" ? "percent" : measure === "value" ? "count" : defaultMode);
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0 || series.length === 0) return null;
  const percent = measure === "percentOnly" || (canSwitch && mode === "percent");
  const wholeOf = (row: GroupRow, index: number) => row.of?.[index] ?? series[index].of;
  const shownValue = (row: GroupRow, index: number): number | null => {
    const value = row.values[index];
    if (value === null || value === undefined) return null;
    if (measure === "papers" && percent) {
      const whole = wholeOf(row, index);
      return whole ? sharePercent(value, whole) : null;
    }
    return value;
  };
  const shown = rows.slice(0, expanded ? rows.length : initialRows);
  const all = shown.flatMap((row) => series.map((_, index) => shownValue(row, index) ?? 0));
  const axis = niceAxis(Math.max(...all), { integer: measure === "papers" && !percent, cap: percent ? 100 : undefined });
  const label = (row: GroupRow, index: number) => {
    const value = shownValue(row, index);
    if (value === null) return "–";
    if (!percent) return formatNumber(value);
    return formatPercent(value);
  };
  const spoken = (row: GroupRow) =>
    series
      .map((group, index) => {
        const count = row.values[index];
        const whole = wholeOf(row, index);
        if (count === null || count === undefined) return `${group.label}: not given`;
        if (measure === "papers") return `${group.label}: ${formatNumber(count)} of ${whole ?? "?"} papers (${formatPercent(sharePercent(count, whole ?? 0))})`;
        if (measure === "percentOnly") return `${group.label}: ${formatPercent(count)}`;
        return `${group.label}: ${formatNumber(count)}${unit ? ` ${unit}` : ""}`;
      })
      .join("; ");
  const title = percent
    ? "Share of each group's papers"
    : measure === "papers"
      ? "Papers"
      : unit
        ? unit.replace(/^./, (c) => c.toUpperCase())
        : "";

  return (
    <div data-chart="grouped">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {title ? <p className="text-xs font-medium text-body">{title}</p> : <span />}
        {canSwitch ? <ModeSwitch mode={mode} onChange={setMode} /> : null}
      </div>
      <div className="mb-3">
        <Legend items={series.map((group) => ({ label: group.label, color: group.color, detail: group.of ? `${formatNumber(group.of)} papers` : undefined }))} />
      </div>
      <ul className="space-y-3">
        {shown.map((row) => (
          <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_5rem]">
            <div className={`col-span-2 min-w-0 text-sm leading-5 text-ink sm:col-span-1 ${row.emphasis ? "font-semibold" : ""}`}>
              {onOpen && row.paperIds?.length ? (
                <button
                  type="button"
                  onClick={() => onOpen(row.paperIds!, row.label)}
                  aria-label={`${row.label}. ${spoken(row)}. Show the papers.`}
                  className="rounded text-left underline-offset-2 hover:underline focus-visible:underline"
                >
                  <span className="line-clamp-2 break-words" title={row.label}>{row.label}</span>
                </button>
              ) : (
                <span className="line-clamp-2 break-words" title={row.label}>{row.label}</span>
              )}
              {row.tag ? (
                <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium ${TAG_TONE[row.tag] ?? "bg-subtle text-body"}`}>{row.tag}</span>
              ) : null}
              {row.sub ? <span className="block text-xs leading-4 text-mute">{row.sub}</span> : null}
            </div>
            <div className="relative space-y-[3px] py-0.5" title={spoken(row)} aria-hidden>
              <Gridlines axis={axis} />
              {series.map((group, index) => {
                const value = shownValue(row, index);
                return (
                  <span key={group.key} className="relative block h-2.5">
                    <span
                      className="absolute inset-y-0 left-0 rounded-r-[3px] rounded-l-[1px]"
                      style={{ width: `${position(value ?? 0, axis)}%`, minWidth: value ? 2 : 0, backgroundColor: group.color }}
                    />
                  </span>
                );
              })}
            </div>
            <div className="space-y-[3px] text-right text-[11px] leading-[10px] tabular-nums text-body" aria-hidden>
              {series.map((group, index) => (
                <span key={group.key} className="block h-2.5">
                  {label(row, index)}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_5rem] gap-x-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_5rem]">
        <span className="hidden sm:block" />
        <AxisTicks axis={axis} percent={percent} />
        <span />
      </div>
      {measure === "papers" && percent ? (
        <p className="mt-2 text-[11px] leading-4 text-mute">Each bar is a share of its own group, so groups of different sizes can be compared. Switch to Papers for the counts.</p>
      ) : null}
      <ShowAll shown={shown.length} total={rows.length} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </div>
  );
}

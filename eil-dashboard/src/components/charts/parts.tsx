"use client";

/*
 * Pieces every chart in src/components/charts shares (docs/38): the switch
 * between counts and shares, the legend, the axis under a plot, and the
 * "show all" control.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { formatNumber, formatPercent, position, type Axis } from "@/lib/charts/scale";
import { segmentClass, segmentedClass } from "@/components/ui/controls";

export type ValueMode = "count" | "percent";

/** Papers | %: the same chart in counts or in shares of a stated whole. */
export function ModeSwitch({ mode, onChange, countLabel = "Papers" }: { mode: ValueMode; onChange: (mode: ValueMode) => void; countLabel?: string }) {
  const option = (value: ValueMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={mode === value}
      className={segmentClass(mode === value)}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Show the values as" className={`${segmentedClass} flex-none`}>
      {option("count", countLabel)}
      {option("percent", "%")}
    </div>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  /** "17 papers": the group's size, shown beside its name. */
  detail?: string;
}

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-body" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="inline-flex min-w-0 items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 flex-none rounded-[3px]" style={{ backgroundColor: item.color }} aria-hidden />
          <span className="min-w-0">
            {item.label}
            {item.detail ? <span className="text-mute">, {item.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Whether a label along an axis is left out on a phone, where every one
 * did not fit (10,000 ran into 12,000 at 390px): every other one, keeping both
 * ends and dropping the one beside the last.
 */
export function narrowHidden(index: number, count: number): boolean {
  const last = count - 1;
  return count > 4 && index !== 0 && index !== last && (index % 2 === 1 || index === last - 1);
}

/** The tick labels under a plot, each at its place on the axis. */
export function AxisTicks({ axis, percent = false }: { axis: Axis; percent?: boolean }) {
  return (
    <div className="relative h-4 text-[11px] tabular-nums text-mute" aria-hidden>
      {axis.ticks.map((tick, index) => {
        const left = position(tick, axis);
        const edge = index === 0 ? "translate-x-0" : index === axis.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2";
        return (
          <span key={tick} className={`absolute top-0 ${edge} whitespace-nowrap ${narrowHidden(index, axis.ticks.length) ? "hidden sm:inline" : ""}`} style={{ left: `${left}%` }}>
            {percent ? formatPercent(tick) : formatNumber(tick)}
          </span>
        );
      })}
    </div>
  );
}

/** Faint vertical lines at each tick, behind the bars. */
export function Gridlines({ axis }: { axis: Axis }) {
  return (
    <>
      {axis.ticks.map((tick) => (
        <span key={tick} className="absolute inset-y-0 w-px bg-hairline" style={{ left: `${position(tick, axis)}%` }} aria-hidden />
      ))}
    </>
  );
}

export function ShowAll({ shown, total, expanded, onToggle, noun = "rows" }: { shown: number; total: number; expanded: boolean; onToggle: () => void; noun?: string }) {
  if (total <= shown && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="mt-3 inline-flex min-h-8 items-center rounded-md px-1 text-xs font-medium text-body underline-offset-2 hover:text-ink hover:underline"
    >
      {expanded ? "Show fewer" : `Show all ${formatNumber(total)} ${noun}`}
    </button>
  );
}

/** A note above a chart: what it shows, or why it is not a chart. */
export function ChartNote({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-xs leading-5 text-body">{children}</p>;
}

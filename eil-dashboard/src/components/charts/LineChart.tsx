"use client";

/*
 * Lines over ordered points, usually years (docs/38): a median per year, or a
 * few series over time. The lines are SVG stretched to the plot; points,
 * ticks and labels are HTML placed by percentage, so text never stretches with
 * the plot. A point with no value breaks its line rather than being drawn as 0.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { Legend, narrowHidden } from "@/components/charts/parts";
import { categoricalColor } from "@/lib/chart-palette";
import { formatNumber, niceAxis, position } from "@/lib/charts/scale";

export interface LineSeries {
  label: string;
  values: Array<number | null>;
  color?: string;
}

const HEIGHT = 180;

export default function LineChart({ labels, series, unit }: { labels: string[]; series: LineSeries[]; unit?: string }) {
  if (labels.length === 0 || series.length === 0) return null;
  const all = series.flatMap((line) => line.values.filter((value): value is number => value !== null && Number.isFinite(value)));
  if (all.length === 0) return null;
  const axis = niceAxis(Math.max(...all), { integer: all.every(Number.isInteger) });
  const x = (index: number) => (labels.length === 1 ? 50 : (index / (labels.length - 1)) * 100);
  const y = (value: number) => 100 - position(value, axis);
  const every = labels.length > 14 ? Math.ceil(labels.length / 10) : 1;
  const colorOf = (line: LineSeries, index: number) => line.color ?? categoricalColor(index);
  const segments = (line: LineSeries) => {
    const runs: string[] = [];
    let current: string[] = [];
    line.values.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        if (current.length > 1) runs.push(current.join(" "));
        current = [];
        return;
      }
      current.push(`${x(index)},${y(value)}`);
    });
    if (current.length > 1) runs.push(current.join(" "));
    return runs;
  };

  return (
    <div data-chart="line">
      {unit ? <p className="mb-2 text-xs font-medium text-body">{unit.replace(/^./, (c) => c.toUpperCase())}</p> : null}
      {series.length > 1 ? (
        <div className="mb-3">
          <Legend items={series.map((line, index) => ({ label: line.label, color: colorOf(line, index) }))} />
        </div>
      ) : null}
      <div className="flex gap-2 pt-2">
        <div className="relative w-9 flex-none text-right text-[11px] tabular-nums text-mute" style={{ height: HEIGHT }} aria-hidden>
          {axis.ticks.map((tick) => (
            <span key={tick} className="absolute right-0 translate-y-1/2" style={{ bottom: `${position(tick, axis)}%` }}>
              {formatNumber(tick)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 px-1.5">
          <div className="relative border-b border-hairline-strong" style={{ height: HEIGHT }}>
            {axis.ticks.slice(1).map((tick) => (
              <span key={tick} className="absolute inset-x-0 h-px bg-hairline" style={{ bottom: `${position(tick, axis)}%` }} aria-hidden />
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              {series.map((line, index) =>
                segments(line).map((points) => (
                  <polyline key={`${line.label}-${points}`} points={points} fill="none" stroke={colorOf(line, index)} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                ))
              )}
            </svg>
            {series.map((line, index) =>
              line.values.map((value, point) =>
                value === null || !Number.isFinite(value) ? null : (
                  <span
                    key={`${line.label}-${point}`}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-surface"
                    style={{ left: `${x(point)}%`, bottom: `${position(value, axis)}%`, backgroundColor: colorOf(line, index) }}
                    title={`${line.label === "" ? "" : `${line.label}, `}${labels[point]}: ${formatNumber(value)}${unit ? ` ${unit}` : ""}`}
                    role="img"
                    aria-label={`${line.label ? `${line.label}, ` : ""}${labels[point]}: ${formatNumber(value)}${unit ? ` ${unit}` : ""}`}
                  />
                )
              )
            )}
          </div>
          <div className="relative mt-1 h-4 text-[11px] tabular-nums text-mute" aria-hidden>
            {labels.map((label, index) =>
              index % every === 0 || index === labels.length - 1 ? (
                <span
                  key={label}
                  className={`absolute whitespace-nowrap ${labels.length > 1 && index === 0 ? "translate-x-0" : labels.length > 1 && index === labels.length - 1 ? "-translate-x-full" : "-translate-x-1/2"} ${narrowHidden(index, labels.length) ? "hidden sm:inline" : ""}`}
                  style={{ left: `${x(index)}%` }}
                >
                  {label}
                </span>
              ) : null
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

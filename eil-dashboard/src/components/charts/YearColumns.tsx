"use client";

/*
 * Values along the years, as columns (docs/38). Every year from the first to
 * the last is on the axis, empty ones included, so a gap reads as a gap.
 * Small counts of papers are stacked one square per paper, as in Bars.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { drawsAsUnits, formatNumber, niceAxis, papers as paperWord, position } from "@/lib/charts/scale";
import type { PaperId } from "@/types/database";

export interface ColumnPoint {
  key: string;
  label: string;
  value: number;
  paperIds?: PaperId[];
}

const PLOT_HEIGHT = 168;

export default function YearColumns({
  points,
  measure,
  unit,
  onOpen,
  paperTitles,
}: {
  points: ColumnPoint[];
  measure: "papers" | "value";
  unit?: string;
  onOpen?: (paperIds: PaperId[], label: string) => void;
  paperTitles?: Map<string, string>;
}) {
  if (points.length === 0) return null;
  const values = points.map((point) => point.value);
  const units = drawsAsUnits(values, measure) && Math.max(...values) <= 12 && points.length <= 24;
  const axis = niceAxis(Math.max(...values), { integer: measure === "papers", target: 4 });
  const every = points.length > 16 ? Math.ceil(points.length / 12) : 1;
  // Squares stack 15px a paper (12px and a 3px gap, 17px on wider screens); the plot fits the tallest.
  const height = units ? Math.max(48, Math.max(...values) * 17 + 8) : PLOT_HEIGHT;
  const describe = (point: ColumnPoint) => (measure === "papers" ? paperWord(point.value) : `${formatNumber(point.value)}${unit ? ` ${unit}` : ""}`);
  const title = measure === "papers" ? "Papers" : unit ? unit.replace(/^./, (c) => c.toUpperCase()) : "";

  return (
    <div data-chart="columns" data-units={units || undefined}>
      {title ? <p className="mb-2 text-xs font-medium text-body">{title}</p> : null}
      {/* Room above the plot for the tallest column's value. */}
      <div className="flex gap-2 pt-4">
        {!units ? (
          <div className="relative w-8 flex-none text-right text-[11px] tabular-nums text-mute" style={{ height }} aria-hidden>
            {axis.ticks.map((tick) => (
              <span key={tick} className="absolute right-0 translate-y-1/2" style={{ bottom: `${position(tick, axis)}%` }}>
                {formatNumber(tick)}
              </span>
            ))}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="relative flex items-end gap-[3px] border-b border-hairline-strong sm:gap-1.5" style={{ height }}>
            {!units
              ? axis.ticks.slice(1).map((tick) => (
                  <span key={tick} className="absolute inset-x-0 h-px bg-hairline" style={{ bottom: `${position(tick, axis)}%` }} aria-hidden />
                ))
              : null}
            {points.map((point) => {
              const ids = point.paperIds ?? [];
              const open = onOpen && ids.length > 0 ? () => onOpen(ids, point.label) : undefined;
              return (
                <div key={point.key} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${point.label}: ${describe(point)}`}>
                  {points.length <= 20 && point.value > 0 && !units ? (
                    <span className="absolute inset-x-0 text-center text-[11px] tabular-nums text-body" style={{ bottom: `calc(${position(point.value, axis)}% + 2px)` }} aria-hidden>
                      {formatNumber(point.value)}
                    </span>
                  ) : null}
                  {units ? (
                    <div className="flex flex-col-reverse items-center gap-[3px] pb-[3px]">
                      {Array.from({ length: point.value }, (_, index) => {
                        const id = ids[index];
                        const name = id !== undefined ? paperTitles?.get(String(id)) : undefined;
                        return onOpen && id !== undefined ? (
                          <button
                            key={index}
                            type="button"
                            onClick={() => onOpen([id], name ?? point.label)}
                            title={name ?? `${point.label}: paper ${index + 1}`}
                            aria-label={name ? `Open ${name}` : `${point.label}: paper ${index + 1}`}
                            className="block h-3 w-3 rounded-[3px] bg-accent transition-transform hover:scale-125 focus-visible:scale-125 sm:h-3.5 sm:w-3.5"
                          />
                        ) : (
                          <span key={index} className="block h-3 w-3 rounded-[3px] bg-accent sm:h-3.5 sm:w-3.5" />
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={open}
                      disabled={!open}
                      aria-label={`${point.label}: ${describe(point)}`}
                      className="w-full max-w-[2.75rem] rounded-t-[4px] rounded-b-[1px] bg-accent transition-opacity enabled:hover:opacity-80"
                      style={{ height: `${position(point.value, axis)}%`, minHeight: point.value > 0 ? 2 : 0 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-[3px] sm:gap-1.5" aria-hidden>
            {points.map((point, index) => (
              <span key={point.key} className="min-w-0 flex-1 truncate text-center text-[11px] tabular-nums text-mute">
                {index % every === 0 || index === points.length - 1 ? point.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      {units ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-mute">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-accent" aria-hidden /> One square is one paper
        </p>
      ) : null}
    </div>
  );
}

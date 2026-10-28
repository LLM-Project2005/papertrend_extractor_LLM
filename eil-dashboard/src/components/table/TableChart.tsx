"use client";

/*
 * The chart above the paper table (docs/42), as an analytics dashboard puts
 * one over its table: the reader picks what it shows. "What was found" counts
 * the studies each shown column has a value for; a number column shows each
 * study's figure with its total, median and range; a label column counts the
 * studies giving each answer. Every figure is computed from the table's cells
 * (paper-table.ts); nothing here is written by a model.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "@/components/theme/ThemeProvider";
import Select from "@/components/ui/Select";
import { panelClass } from "@/components/ui/controls";
import { chartAnimationActive, chartTheme, tickStyle } from "@/lib/chart-theme";
import { wrappedTick } from "@/lib/chart-ticks";
import { tooltipTheme } from "@/lib/chart-tooltip";
import type { TableChartData } from "@/lib/paper-table";
import { labelColumn, useIsNarrow } from "@/lib/use-narrow";

export default function TableChart({
  data,
  choice,
  choices,
  onChoose,
  byStudy,
}: {
  data: TableChartData;
  choice: string;
  choices: Array<{ value: string; label: string }>;
  onChoose: (value: string) => void;
  /** A number column: one bar per study, too many to name on the axis, so each is named in its tooltip. */
  byStudy: boolean;
}) {
  const { theme, hydrated } = useTheme();
  const dark = hydrated && theme === "dark";
  const ct = chartTheme(dark);
  const tooltip = tooltipTheme(dark);
  const labels = labelColumn(useIsNarrow(), { width: 200, chars: 30 });
  const height = byStudy ? 260 : Math.min(420, data.bars.length * 30 + 40);

  return (
    <section className={`${panelClass} p-4 sm:p-5`} aria-label={`Chart: ${data.title}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {data.stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-mute">{stat.label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <Select value={choice} options={choices} onChange={onChoose} label="What the chart shows" prefix="Chart:" size="sm" align="end" />
      </div>
      {data.bars.length === 0 ? (
        <p className="mt-6 text-sm text-mute">
          {byStudy ? "No study has a value for this column yet." : "Nothing to count yet: fill the table first."}
        </p>
      ) : (
        <div className="mt-4 overflow-y-auto" style={{ maxHeight: 420 }}>
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {byStudy ? (
                <BarChart data={data.bars} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="label" tick={false} stroke={ct.axisLine} height={8} />
                  <YAxis tick={tickStyle(ct, 12)} stroke={ct.axisLine} width={48} allowDecimals />
                  <Tooltip {...tooltip} formatter={(_value, _name, item) => [(item as { payload?: { detail?: string } })?.payload?.detail ?? "", data.measure]} />
                  <Bar isAnimationActive={chartAnimationActive()} dataKey="value" name={data.measure} fill={ct.barFill} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              ) : (
                <BarChart data={data.bars} layout="vertical" margin={{ left: 8, right: 24, top: 0, bottom: 0 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis type="number" allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                  <YAxis type="category" dataKey="label" width={labels.width} tick={wrappedTick(ct, labels.chars, 12)} interval={0} stroke={ct.axisLine} />
                  <Tooltip {...tooltip} formatter={(_value, _name, item) => [(item as { payload?: { detail?: string } })?.payload?.detail ?? "", data.measure]} />
                  <Bar isAnimationActive={chartAnimationActive()} dataKey="value" name={data.measure} fill={ct.barFill} radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-mute">{data.note}</p>
    </section>
  );
}

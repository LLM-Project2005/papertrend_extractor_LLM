"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import MetricCard from "@/components/MetricCard";
import { useTheme } from "@/components/theme/ThemeProvider";
import { TRACK_COLS, TRACK_COLORS, type TrackKey } from "@/lib/constants";
import type { TrendRow, TrackRow } from "@/types/database";
import type { VisualizationChartKey } from "@/types/visualization";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  selectedTracks: string[];
  useMock: boolean;
  visibleCharts?: VisualizationChartKey[];
}

export default function Overview({
  trends,
  tracksSingle,
  tracksMulti,
  selectedTracks,
  useMock,
  visibleCharts,
}: Props) {
  const { theme, hydrated } = useTheme();
  const isDark = hydrated && theme === "dark";
  const nPapers = new Set([
    ...trends.map((row) => row.paper_id),
    ...tracksSingle.map((row) => row.paper_id),
    ...tracksMulti.map((row) => row.paper_id),
  ]).size;
  const nTopics = new Set(trends.map((row) => row.topic)).size;
  const nKeywords = new Set(trends.map((row) => row.keyword)).size;
  const years = [
    ...new Set([
      ...trends.map((row) => row.year),
      ...tracksSingle.map((row) => row.year),
      ...tracksMulti.map((row) => row.year),
    ]),
  ].sort();
  const yearSpan =
    years.length > 0 ? `${years[0]} to ${years[years.length - 1]}` : "No data";

  const papersByYear = Object.entries(
    [...trends, ...tracksSingle, ...tracksMulti].reduce<Record<string, Set<number>>>(
      (accumulator, row) => {
        (accumulator[row.year] ??= new Set()).add(row.paper_id);
        return accumulator;
      },
      {}
    )
  )
    .map(([year, ids]) => ({ year, papers: ids.size }))
    .sort((left, right) => left.year.localeCompare(right.year));

  const buildDonut = (rows: TrackRow[]) =>
    TRACK_COLS.filter((track) => selectedTracks.includes(track)).map((track) => ({
      name: track,
      value: rows.reduce(
        (sum, row) => sum + (row[track.toLowerCase() as keyof TrackRow] as number),
        0
      ),
    }));

  const donutSingle = buildDonut(tracksSingle);
  const donutMulti = buildDonut(tracksMulti);
  const chartGrid = isDark ? "#3f3f46" : "#d7dee8";
  const chartAxis = isDark ? "#a3a3a3" : "#7c8aa0";
  const barFill = isDark ? "#d4a574" : "#334155";
  const orderedCharts =
    visibleCharts?.filter((chart): chart is VisualizationChartKey =>
      [
        "overview_metrics",
        "papers_per_year",
        "track_single_breakdown",
        "track_multi_breakdown",
      ].includes(chart)
    ) ?? [
      "overview_metrics",
      "papers_per_year",
      "track_single_breakdown",
      "track_multi_breakdown",
    ];
  const tooltipTheme = isDark
    ? {
        contentStyle: {
          backgroundColor: "#1f1f1f",
          border: "1px solid #383838",
          borderRadius: "16px",
          color: "#f5f5f5",
        },
        cursor: { fill: "rgba(255,255,255,0.04)" },
      }
    : {
        contentStyle: {
          backgroundColor: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "16px",
          color: "#0f172a",
        },
        cursor: { fill: "rgba(15,23,42,0.04)" },
      };

  function renderTrackBreakdown(
    title: string,
    subtitle: string,
    items: { name: string; value: number }[]
  ) {
    const total = items.reduce((sum, item) => sum + item.value, 0);

    return (
      <section className="app-surface px-4 py-4 sm:px-5 sm:py-5">
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {title}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
            <div className="mt-4 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={items}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={84}
                    paddingAngle={2}
                    stroke={isDark ? "#1f1f1f" : "#ffffff"}
                  >
                    {items.map((item) => (
                      <Cell key={item.name} fill={TRACK_COLORS[item.name as TrackKey]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipTheme} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-3">
            {items.map((item) => {
              const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
              return (
                <div
                  key={item.name}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#303030] dark:bg-[#202020]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: TRACK_COLORS[item.name as TrackKey] }}
                      />
                      <span className="text-sm font-medium text-slate-900 dark:text-[#ececec]">
                        {item.name}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                        {item.value}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#8f8f8f]">
                        {share}% of selected papers
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-[#2b2b2b]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(share, item.value > 0 ? 8 : 0)}%`,
                        backgroundColor: TRACK_COLORS[item.name as TrackKey],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  function renderChart(chartKey: VisualizationChartKey) {
    if (chartKey === "overview_metrics") {
      return (
        <div key={chartKey} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total papers" value={nPapers} />
          <MetricCard label="Unique topics" value={nTopics} />
          <MetricCard label="Unique keywords" value={nKeywords} />
          <MetricCard label="Coverage" value={yearSpan} />
        </div>
      );
    }

    if (chartKey === "papers_per_year" && papersByYear.length > 0) {
      return (
        <section key={chartKey} className="app-surface px-4 py-4 sm:px-5 sm:py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Papers published per year
          </h3>
          <div className="mt-4 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={papersByYear}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke={chartAxis} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke={chartAxis} />
                <Tooltip {...tooltipTheme} />
                <Bar dataKey="papers" fill={barFill} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      );
    }

    if (chartKey === "track_single_breakdown" && donutSingle.some((item) => item.value > 0)) {
      return (
        <div key={chartKey}>
          {renderTrackBreakdown(
            "Track distribution",
            "Single-label assignments",
            donutSingle
          )}
        </div>
      );
    }

    if (chartKey === "track_multi_breakdown" && donutMulti.some((item) => item.value > 0)) {
      return (
        <div key={chartKey}>
          {renderTrackBreakdown(
            "Track overlap",
            "Multi-label assignments",
            donutMulti
          )}
        </div>
      );
    }

    return null;
  }

  return (
    <div className="space-y-5">
      <section className="app-surface px-4 py-4 sm:px-5 sm:py-5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Overview
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          A quick read on corpus coverage, publication volume, and track balance.
        </p>
        {useMock && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            Preview data is active. Real results will replace this after Supabase is populated.
          </div>
        )}
      </section>

      {orderedCharts.map((chartKey) => renderChart(chartKey))}
    </div>
  );
}

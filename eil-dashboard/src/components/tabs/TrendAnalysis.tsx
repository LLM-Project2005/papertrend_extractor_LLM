"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Takeaway } from "@/components/dashboard/DashboardNotes";
import { TOPIC_PALETTE } from "@/lib/constants";
import {
  SHIFT_MIN_PAPERS,
  listOf,
  plural,
  subjectRows,
  themePaperCounts,
  themePapersByYear,
  themeShifts,
  undatedPaperCount,
  yearAxis,
  type ThemeShift,
} from "@/lib/dashboard-analytics";
import type { TrendRow } from "@/types/database";
import type { VisualizationPlanChart } from "@/types/visualization";
import { useTheme } from "@/components/theme/ThemeProvider";
import { chartTheme, tickStyle } from "@/lib/chart-theme";

interface Props {
  trends: TrendRow[];
  planCharts?: VisualizationPlanChart[];
  onDrilldown?: (target: { topic?: string; year?: string; paperIds?: string[] }) => void;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default function TrendAnalysis({ trends, planCharts, onDrilldown }: Props) {
  const { theme, hydrated } = useTheme();
  const ct = chartTheme(hydrated && theme === "dark");
  const [topN, setTopN] = useState(8);
  const orderedCharts =
    planCharts?.map((chart) => chart.chart_key).filter(
      (chart): chart is "topic_area" | "emerging_topics" | "declining_topics" =>
        ["topic_area", "emerging_topics", "declining_topics"].includes(chart)
    ) ?? ["topic_area", "emerging_topics", "declining_topics"];
  const topicAreaConfig = planCharts?.find((chart) => chart.chart_key === "topic_area")?.config;
  const effectiveTopN = topicAreaConfig?.top_n ?? topN;

  // What was studied; method themes are shown on the Overview.
  const subjects = useMemo(() => subjectRows(trends), [trends]);
  const axis = useMemo(() => yearAxis(subjects.map((row) => row.year)), [subjects]);
  const undated = useMemo(() => undatedPaperCount(subjects), [subjects]);

  const topThemes = useMemo(
    () =>
      themePaperCounts(subjects)
        .filter((entry) => entry.papers >= 2)
        .slice(0, effectiveTopN)
        .map((entry) => entry.topic),
    [effectiveTopN, subjects]
  );
  const byYear = useMemo(() => themePapersByYear(subjects, topThemes, axis.years), [axis.years, subjects, topThemes]);
  const shifts = useMemo(() => themeShifts(subjects), [subjects]);

  if (trends.length === 0) {
    return (
      <div className="app-surface px-5 py-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">No data for the selected filters.</p>
      </div>
    );
  }

  const periods = shifts.periods;
  const gaining = shifts.emerging.map((shift) => shift.topic);
  const losing = shifts.declining.map((shift) => shift.topic);
  const takeaway = !periods
    ? "Too few dated years to compare periods: at least two are needed."
    : gaining.length + losing.length === 0
      ? `Comparing ${periods.earlyLabel} (${plural(periods.earlyPapers, "paper")}) with ${periods.lateLabel} (${periods.latePapers}), no theme has shifted by a paper or more beyond what the period sizes predict${shifts.judged === 0 ? ` - none yet has the ${SHIFT_MIN_PAPERS} papers a shift needs` : ""}.`
      : `Comparing ${periods.earlyLabel} (${plural(periods.earlyPapers, "paper")}) with ${periods.lateLabel} (${periods.latePapers}): ${
          gaining.length > 0 ? `${listOf(gaining.slice(0, 3))} ${gaining.length === 1 ? "is" : "are"} gaining ground` : ""
        }${gaining.length > 0 && losing.length > 0 ? "; " : ""}${
          losing.length > 0 ? `${listOf(losing.slice(0, 3))} ${losing.length === 1 ? "is" : "are"} losing it` : ""
        }.`;

  const shiftRows = (items: ThemeShift[]) =>
    items.slice(0, 8).map((shift) => ({
      topic: shift.topic,
      earlier: Math.round(shift.earlyShare * 1000) / 10,
      later: Math.round(shift.lateShare * 1000) / 10,
      early: shift.early,
      late: shift.late,
      paperIds: shift.paperIds,
    }));

  function renderShiftChart(title: string, items: ThemeShift[]) {
    const rows = shiftRows(items);
    if (rows.length === 0 || !periods) return null;
    return (
      <div>
        <p className="mb-3 text-sm font-medium text-slate-800 dark:text-[#e5e5e5]">{title}</p>
        <div style={{ height: Math.max(150, rows.length * 56 + 60) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={ct.grid} />
              <XAxis type="number" unit="%" tick={tickStyle(ct, 11)} stroke={ct.axisLine} />
              <YAxis
                type="category"
                dataKey="topic"
                width={190}
                tick={tickStyle(ct, 11)}
                tickFormatter={(value) => truncate(String(value), 28)}
                stroke={ct.axisLine}
              />
              <Tooltip
                formatter={(value, name, item) => {
                  const payload = (item as { payload?: { early: number; late: number } })?.payload;
                  const count = name === "earlier" ? payload?.early : payload?.late;
                  return [`${value}% (${plural(Number(count ?? 0), "paper")})`, name === "earlier" ? periods.earlyLabel : periods.lateLabel];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => (value === "earlier" ? `${periods.earlyLabel} (${periods.earlyPapers} papers)` : `${periods.lateLabel} (${periods.latePapers} papers)`)}
              />
              <Bar
                dataKey="earlier"
                fill={ct.barFillMuted}
                radius={[0, 4, 4, 0]}
                onClick={(entry) => {
                  const row = entry as { topic?: string; paperIds?: string[] };
                  if (row?.topic) onDrilldown?.({ topic: row.topic, paperIds: row.paperIds });
                }}
                className={onDrilldown ? "cursor-pointer" : undefined}
              />
              <Bar
                dataKey="later"
                fill={ct.barFill}
                radius={[0, 4, 4, 0]}
                onClick={(entry) => {
                  const row = entry as { topic?: string; paperIds?: string[] };
                  if (row?.topic) onDrilldown?.({ topic: row.topic, paperIds: row.paperIds });
                }}
                className={onDrilldown ? "cursor-pointer" : undefined}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Trend analysis</h2>
        <Takeaway>{takeaway}</Takeaway>
      </section>

      {orderedCharts.includes("topic_area") ? (
        <section className="app-surface px-5 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Themes by year</h3>
            {!topicAreaConfig?.top_n ? (
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                Themes shown: {topN}
                <input
                  type="range"
                  min={3}
                  max={15}
                  value={topN}
                  onChange={(event) => setTopN(+event.target.value)}
                  className="w-32"
                />
              </label>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Papers per year in the themes shared by two or more papers. Every year in the range has a slot, so a year with no papers shows as a gap.
          </p>
          {topThemes.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-[#bdbdbd]">
              No theme is shared by two or more papers in the current filters, so there is no trend to draw.
            </p>
          ) : (
            <div className="mt-4 h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byYear}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => truncate(String(value), 40)} />
                  {topThemes.map((topic, index) => (
                    <Bar
                      key={topic}
                      dataKey={topic}
                      stackId="themes"
                      fill={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                      onClick={(entry) => {
                        const year = entry && "year" in entry ? String(entry.year) : undefined;
                        onDrilldown?.({ topic, year });
                      }}
                      className={onDrilldown ? "cursor-pointer" : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {axis.empty.length > 0 || undated > 0 ? (
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-[#a3a3a3]">
              {axis.empty.length > 0 ? `No papers from ${listOf(axis.empty)}. ` : ""}
              {undated > 0 ? `${plural(undated, "paper")} without a readable year ${undated === 1 ? "is" : "are"} not drawn.` : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {orderedCharts.includes("emerging_topics") || orderedCharts.includes("declining_topics") ? (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Gaining and losing ground</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            {periods
              ? `The collection split where its dated papers halve: ${periods.earlyLabel} (${periods.earlyPapers} papers) and ${periods.lateLabel} (${periods.latePapers}). A theme is shown when it has at least ${SHIFT_MIN_PAPERS} papers, has at least one paper more (or fewer) in the later period than the two period sizes alone predict, and would still lean the same way if any one of its papers were removed. Bars show each theme's share of each period's papers.`
              : "Needs papers from at least two different years."}
          </p>
          {shifts.emerging.length + shifts.declining.length > 0 ? (
            <div className="mt-5 grid gap-6 xl:grid-cols-2">
              {orderedCharts.includes("emerging_topics") ? renderShiftChart("Gaining ground", shifts.emerging) : null}
              {orderedCharts.includes("declining_topics") ? renderShiftChart("Losing ground", shifts.declining) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600 dark:text-[#bdbdbd]">
              {periods
                ? shifts.judged === 0
                  ? `No theme has the ${SHIFT_MIN_PAPERS} or more papers needed to judge a shift.`
                  : `Of ${plural(shifts.judged, "theme")} with ${SHIFT_MIN_PAPERS} or more papers, none has shifted by a paper or more beyond what the period sizes predict. That is itself a finding: the themes here are holding steady.`
                : "There is only one dated year in the current filters."}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

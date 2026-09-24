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
import Link from "next/link";
import MetricCard from "@/components/MetricCard";
import { CategoriesOffNotice, Takeaway } from "@/components/dashboard/DashboardNotes";
import { useTheme } from "@/components/theme/ThemeProvider";
import { TRACK_COLS, TRACK_COLORS, type TrackKey } from "@/lib/constants";
import { normalizeCategoryKey, type CategoryOption } from "@/lib/category-options";
import {
  keywordPaperCounts,
  likelyDuplicatePapers,
  listOf,
  methodRows,
  plural,
  subjectRows,
  themePaperCounts,
  undatedPaperCount,
  yearAxis,
} from "@/lib/dashboard-analytics";
import type { CategoryAssignmentRow, PaperId, TrendRow, TrackRow } from "@/types/database";
import type { VisualizationChartKey } from "@/types/visualization";
import { isDatedYear } from "@/lib/dated-year";
import { chartTheme, tickStyle } from "@/lib/chart-theme";
import { labelColumn, useIsNarrow } from "@/lib/use-narrow";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  categoryAssignments?: CategoryAssignmentRow[];
  categoryOptions?: CategoryOption[];
  selectedTracks: string[];
  categoryLabels?: Record<TrackKey, string>;
  /** False when the repository does not classify papers. */
  classificationEnabled?: boolean;
  visibleCharts?: VisualizationChartKey[];
  onDrilldown?: (target: {
    track?: string;
    year?: string;
    topic?: string;
    keyword?: string;
    paperIds?: string[];
  }) => void;
}

const TOP_THEMES = 10;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default function Overview({
  trends,
  tracksSingle,
  tracksMulti,
  categoryAssignments = [],
  categoryOptions = [],
  selectedTracks,
  categoryLabels,
  classificationEnabled = true,
  visibleCharts,
  onDrilldown,
}: Props) {
  const { theme, hydrated } = useTheme();
  const isDark = hydrated && theme === "dark";
  const ct = chartTheme(isDark);
  const themeLabels = labelColumn(useIsNarrow(), { width: 300, chars: 46 });

  const allRows = [...trends, ...tracksSingle, ...tracksMulti, ...categoryAssignments];
  const nPapers = new Set(allRows.map((row) => row.paper_id)).size;
  const subjects = subjectRows(trends);
  const themes = themePaperCounts(subjects);
  const methods = themePaperCounts(methodRows(trends));
  // Counted exactly as the Keyword Explorer counts them - subject rows, spacing
  // and case folded - so the two tabs never disagree (they said 623 and 523).
  const nKeywords = keywordPaperCounts(subjects).length;
  const dated = [...new Set(allRows.map((row) => row.year))].filter(isDatedYear).sort();
  const yearSpan = dated.length > 0 ? (dated[0] === dated[dated.length - 1] ? dated[0] : `${dated[0]}–${dated[dated.length - 1]}`) : "No dated papers";
  const undated = undatedPaperCount(allRows as TrendRow[]);

  const papersByYearMap = allRows.reduce<Record<string, Set<PaperId>>>((accumulator, row) => {
    (accumulator[row.year] ??= new Set()).add(row.paper_id);
    return accumulator;
  }, {});
  // Every year in the range gets a slot, so a gap in publishing is visible as a
  // gap rather than two distant years drawn as neighbours.
  const axis = yearAxis(dated);
  const papersByYear = axis.years.map((year) => ({ year, papers: papersByYearMap[year]?.size ?? 0 }));
  const peak = papersByYear.reduce<{ year: string; papers: number } | null>(
    (best, entry) => (!best || entry.papers > best.papers ? entry : best),
    null
  );

  const shared = themes.filter((entry) => entry.papers >= 2);
  const duplicates = likelyDuplicatePapers(trends);
  const topThemes = themes.slice(0, TOP_THEMES);

  const buildDynamicDonut = (assignmentType: "single" | "multi") => {
    const optionKeys = new Set(categoryOptions.map((category) => category.key));
    const selectedKeys = selectedTracks
      .map((track) => normalizeCategoryKey(track))
      .filter((track) => optionKeys.has(track));
    const activeKeys = new Set(selectedKeys.length > 0 ? selectedKeys : [...optionKeys]);
    const papersByCategory = new Map<string, Set<PaperId>>();

    categoryAssignments
      .filter(
        (row) =>
          row.assignment_type === assignmentType &&
          activeKeys.has(normalizeCategoryKey(row.category_key))
      )
      .forEach((row) => {
        const key = normalizeCategoryKey(row.category_key);
        const set = papersByCategory.get(key) ?? new Set<PaperId>();
        set.add(row.paper_id);
        papersByCategory.set(key, set);
      });

    return categoryOptions
      .filter((category) => activeKeys.has(category.key))
      .map((category) => ({
        key: category.key,
        name: category.label,
        value: papersByCategory.get(category.key)?.size ?? 0,
        color: category.color,
      }));
  };

  const buildLegacyDonut = (rows: TrackRow[]) =>
    TRACK_COLS.filter((track) => selectedTracks.includes(track)).map((track) => ({
      key: track,
      name: categoryLabels?.[track as TrackKey] || track,
      value: rows.reduce(
        (sum, row) => sum + (row[track.toLowerCase() as keyof TrackRow] as number),
        0
      ),
      color: TRACK_COLORS[track as TrackKey],
    }));

  const hasDynamicCategories = categoryAssignments.length > 0;
  const donutSingle = !classificationEnabled ? [] : hasDynamicCategories ? buildDynamicDonut("single") : buildLegacyDonut(tracksSingle);
  const donutMulti = !classificationEnabled ? [] : hasDynamicCategories ? buildDynamicDonut("multi") : buildLegacyDonut(tracksMulti);
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
    items: { key: string; name: string; value: number; color: string }[]
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
                    onClick={(entry) => {
                      if (entry && "key" in entry) {
                        onDrilldown?.({ track: String(entry.key) });
                      }
                    }}
                    className={onDrilldown ? "cursor-pointer" : undefined}
                  >
                    {items.map((item) => (
                      <Cell key={item.key} fill={item.color} />
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
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onDrilldown?.({ track: item.key })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: item.color }}
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
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-[#050505]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(share, item.value > 0 ? 8 : 0)}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  function renderTopThemes() {
    if (topThemes.length === 0) return null;
    return (
      <section key="top_themes" className="app-surface px-4 py-4 sm:px-5 sm:py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">What this repository studies</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Themes by number of papers. Each theme gathers topics from different papers that share a research focus.
        </p>
        <div className="mt-4" style={{ height: Math.max(160, topThemes.length * 34 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topThemes} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={ct.grid} />
              <XAxis type="number" allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
              <YAxis
                type="category"
                dataKey="topic"
                width={themeLabels.width}
                tick={tickStyle(ct, 12)}
                tickFormatter={(value) => truncate(String(value), themeLabels.chars)}
                stroke={ct.axisLine}
              />
              <Tooltip {...tooltipTheme} />
              <Bar
                dataKey="papers"
                name="Papers"
                fill={ct.barFill}
                radius={[0, 6, 6, 0]}
                onClick={(entry) => {
                  if (entry && "topic" in entry) onDrilldown?.({ topic: String(entry.topic) });
                }}
                className={onDrilldown ? "cursor-pointer" : undefined}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    );
  }

  function renderMethods() {
    if (methods.length === 0) return null;
    return (
      <section key="methods" className="app-surface px-4 py-4 sm:px-5 sm:py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">How these studies were done</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Research designs and instruments, kept apart from the themes above so they do not crowd out what was studied.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {methods.slice(0, 8).map((entry) => (
            <li key={entry.topic}>
              <button
                type="button"
                onClick={() => onDrilldown?.({ topic: entry.topic })}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
              >
                <span className="font-medium text-slate-900 dark:text-[#ececec]">{entry.topic}</span>
                <span className="flex-none text-xs text-slate-600 dark:text-[#a3a3a3]">{plural(entry.papers, "paper")}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  function renderChart(chartKey: VisualizationChartKey) {
    if (chartKey === "overview_metrics") {
      return (
        <div key={chartKey} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Papers" value={nPapers} />
          {/* "Themes 39" next to "Papers 39" read like a bug; how many themes
              connect papers is the number the grouping exists to produce. */}
          <MetricCard label="Shared themes" value={shared.length} />
          <MetricCard label="Keywords" value={nKeywords} />
          <MetricCard label="Years covered" value={yearSpan} />
        </div>
      );
    }

    if (chartKey === "papers_per_year" && papersByYear.length > 0) {
      return (
        <section key={chartKey} className="app-surface px-4 py-4 sm:px-5 sm:py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Papers published per year
          </h3>
          <div className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={papersByYear}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <Tooltip {...tooltipTheme} />
                <Bar
                  dataKey="papers"
                  name="Papers"
                  fill={ct.barFill}
                  radius={[6, 6, 0, 0]}
                  onClick={(entry) => {
                    if (entry && "year" in entry) {
                      onDrilldown?.({ year: String(entry.year) });
                    }
                  }}
                  className={onDrilldown ? "cursor-pointer" : undefined}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {axis.empty.length > 0 || undated > 0 ? (
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-[#a3a3a3]">
              {axis.empty.length > 0 ? `No papers from ${listOf(axis.empty)}. ` : ""}
              {undated > 0
                ? `${plural(undated, "paper")} ${undated === 1 ? "has" : "have"} no readable publication year and ${undated === 1 ? "is" : "are"} not drawn here.`
                : ""}
            </p>
          ) : null}
        </section>
      );
    }

    if (chartKey === "track_single_breakdown") {
      if (!classificationEnabled) return <div key={chartKey}><CategoriesOffNotice compact /></div>;
      if (!donutSingle.some((item) => item.value > 0)) return null;
      return (
        <div key={chartKey}>
          {renderTrackBreakdown(
            "Category distribution",
            "Single-label assignments",
            donutSingle
          )}
        </div>
      );
    }

    if (chartKey === "track_multi_breakdown" && classificationEnabled && donutMulti.some((item) => item.value > 0)) {
      return (
        <div key={chartKey}>
          {renderTrackBreakdown(
            "Category overlap",
            "Multi-label assignments",
            donutMulti
          )}
        </div>
      );
    }

    return null;
  }

  const leaders = shared.slice(0, 3).map((entry) => `${entry.topic} (${entry.papers})`);

  return (
    <div className="space-y-5">
      <section className="app-surface px-4 py-4 sm:px-5 sm:py-5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Overview
        </h2>
        {nPapers === 0 ? (
          <Takeaway>No papers match the current filters.</Takeaway>
        ) : (
          <Takeaway>
            {plural(nPapers, "paper")}
            {dated.length > 0 ? `, published ${yearSpan}` : ""}
            {peak && peak.papers > 1 && papersByYear.length > 2 ? `, most in ${peak.year} (${peak.papers})` : ""}.{" "}
            {leaders.length > 0
              ? `The largest themes are ${listOf(leaders)}; ${plural(shared.length, "theme")} ${shared.length === 1 ? "is" : "are"} shared by two or more papers.`
              : "No theme is shared by more than one paper yet."}
          </Takeaway>
        )}
      </section>

      {duplicates.length > 0 ? (
        <details className="app-surface group px-4 py-3 sm:px-5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-slate-800 dark:text-[#e5e5e5]">
            <span>
              <span className="font-semibold">
                {plural(duplicates.length, "paper")} {duplicates.length === 1 ? "looks" : "look"} like a second copy of another paper here.
              </span>{" "}
              Each is counted twice in every chart.
            </span>
            <span className="flex-none text-sm font-medium text-slate-900 underline underline-offset-4 dark:text-white">
              <span className="group-open:hidden">Show which</span>
              <span className="hidden group-open:inline">Hide</span>
            </span>
          </summary>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-[#bdbdbd]">
            Their titles nearly match another paper&apos;s. If they are the same study, removing one copy from the Library corrects the counts.
          </p>
          <ul className="mt-3 space-y-2 pb-2">
            {duplicates.slice(0, 12).map((duplicate) => (
              <li
                key={duplicate.paperId}
                className="flex flex-col gap-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm dark:border-[#1f1f1f] sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0 text-slate-800 dark:text-[#e5e5e5]">
                  <span className="font-medium">{duplicate.title}</span>
                  {duplicate.title === duplicate.originalTitle ? " (same title as another upload)" : ` \u2014 matches "${duplicate.originalTitle}"`}
                </span>
                <Link
                  href={`/workspace/library?paperId=${duplicate.paperId}`}
                  className="inline-flex min-h-9 flex-none items-center text-sm font-medium text-slate-900 underline underline-offset-4 dark:text-white"
                >
                  Open in Library
                </Link>
              </li>
            ))}
          </ul>
          {duplicates.length > 12 ? (
            <p className="pb-2 text-xs text-slate-600 dark:text-[#a3a3a3]">And {plural(duplicates.length - 12, "more")}.</p>
          ) : null}
        </details>
      ) : null}

      {orderedCharts.includes("overview_metrics") ? renderChart("overview_metrics") : null}
      {renderTopThemes()}
      {orderedCharts.filter((chart) => chart !== "overview_metrics").map((chartKey) => renderChart(chartKey))}
      {renderMethods()}
    </div>
  );
}

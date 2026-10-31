"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import Heatmap from "@/components/Heatmap";
import { Takeaway } from "@/components/dashboard/DashboardNotes";
import { NEUTRAL_MARK } from "@/lib/chart-palette";
import { readableTextOn } from "@/lib/contrast";
import {
  SHIFT_MIN_PAPERS,
  keywordPaperCounts,
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
import { keywordKey, markPaperIds, paperIdsByKeywordKey } from "@/lib/dashboard-drilldown";
import { isDatedYear } from "@/lib/dated-year";
import ChartValues, { paperCount } from "@/components/tabs/ChartValues";
import ChartCsvButton from "@/components/tabs/ChartCsvButton";
import { MAX_STACKED_SERIES, tooltipTheme } from "@/lib/chart-tooltip";
import type { TrendRow } from "@/types/database";
import type { VisualizationPlanChart } from "@/types/visualization";
import { useTheme } from "@/components/theme/ThemeProvider";
import { chartTheme, tickStyle, chartAnimationActive } from "@/lib/chart-theme";
import { labelColumn, useIsNarrow } from "@/lib/use-narrow";
import { seriesTable } from "@/lib/chart-csv";
import { wrappedTick } from "@/lib/chart-ticks";
import { NO_THEME_COLORS, colouredThemes, hasThemeColor, themeColor, tint, type ThemeColors } from "@/lib/theme-colors";

/*
 * Area Analysis, its first half: the repository's themes (2026-10-24 review).
 * Everything about themes sits here - how big each is, how each moved year by
 * year, which gained or lost ground, and what each gathers - where it was
 * split between this tab and the Keyword Explorer. Three charts drew the same
 * numbers (papers per theme per year) as bars, a grid and lines; they are one
 * card now, with a switch between the three. Every theme wears its own colour
 * here, in the other charts and in the paper window (theme-colors.ts).
 */

interface Props {
  trends: TrendRow[];
  /** The repository's theme colours, from all its papers (never the filtered view). */
  themeColors?: ThemeColors;
  planCharts?: VisualizationPlanChart[];
  onDrilldown?: (target: { topic?: string; keyword?: string; year?: string; paperIds?: string[] }) => void;
}

type TimeView = "bars" | "lines" | "grid";

const TIME_VIEWS: Array<{ value: TimeView; label: string }> = [
  { value: "bars", label: "Bars" },
  { value: "lines", label: "Lines" },
  { value: "grid", label: "Grid" },
];

/** Themes a reader can pick to compare over time. */
const PICKABLE_THEMES = 20;
/** Shown until the reader picks. */
const DEFAULT_PICKED = 5;

/**
 * Greys for themes without a colour of their own, told apart by lightness
 * when two or three share a chart, and each clearing 3:1 on its page.
 */
function greySteps(isDark: boolean): string[] {
  return isDark ? [NEUTRAL_MARK, "#b9bdc4", "#d9dce0"] : [NEUTRAL_MARK, "#5c6169", "#33373d"];
}

/** The colour each series in one chart is drawn in: its theme's, or a grey step. */
export function seriesColors(themes: string[], colors: ThemeColors, isDark: boolean): Record<string, string> {
  const greys = greySteps(isDark);
  let grey = 0;
  const result: Record<string, string> = {};
  for (const theme of themes) {
    result[theme] = hasThemeColor(colors, theme) ? themeColor(colors, theme, isDark) : greys[grey++ % greys.length];
  }
  return result;
}

/** The grid's rows: the picked themes with a paper in some year (a row of zeros says nothing). */
export function gridThemes(themes: string[], byYear: Array<Record<string, unknown>>): string[] {
  return themes.filter((topic) => byYear.some((row) => Number(row[topic] ?? 0) > 0));
}

/** A theme's dot beside its name: the colour carries identity, the name stays in ink. */
function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: color }} />;
}

/** One legend for a chart's themes, in full: Recharts' own cut names short. */
function SeriesLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  if (items.length === 0) return null;
  return (
    <ul data-series-legend="" className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink">
      {items.map((item) => (
        <li key={item.label} className="inline-flex min-w-0 items-center gap-1.5">
          {item.dashed ? (
            <span aria-hidden="true" className="inline-block w-4 flex-none border-t-2 border-dashed" style={{ borderColor: item.color }} />
          ) : (
            <Dot color={item.color} />
          )}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

const TreemapCell = (props: {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  value: number;
  depth?: number;
  fill?: string;
  edge?: string;
  onDrilldown?: Props["onDrilldown"];
  paperIds?: string[];
}) => {
  const { x, y, width, height, name, value, depth, edge = "#ffffff", onDrilldown, paperIds } = props;
  const fill = props.fill ?? NEUTRAL_MARK;
  const textFill = readableTextOn(fill, ["#ffffff", "#0a0a0a"]);
  // The root spans the whole chart under the cells, labelled with the sum of
  // every theme - "63 papers" in a 39-paper repository, hidden but in the page.
  if (depth === 0) return null;
  if (width < 4 || height < 4) return null;
  const maxChars = Math.floor((width - 12) / 6.5);
  const label = name && name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}…` : name;
  return (
    <g className={onDrilldown ? "cursor-pointer" : undefined} onClick={() => onDrilldown?.({ topic: name, paperIds })}>
      <title>{`${name}: ${value} paper${value === 1 ? "" : "s"}`}</title>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke={edge} strokeWidth={2} rx={6} />
      {width > 60 && height > 34 && maxChars >= 6 ? (
        <>
          <text x={x + 8} y={y + 18} fill={textFill} fontSize={11} fontWeight={600}>
            {label}
          </text>
          <text x={x + 8} y={y + 32} fill={textFill} fontSize={10} opacity={0.85}>
            {value} paper{value === 1 ? "" : "s"}
          </text>
        </>
      ) : null}
    </g>
  );
};

export default function TrendAnalysis({ trends, themeColors = NO_THEME_COLORS, planCharts, onDrilldown }: Props) {
  const { theme, hydrated } = useTheme();
  const isDark = hydrated && theme === "dark";
  const ct = chartTheme(isDark);
  const shiftLabels = labelColumn(useIsNarrow(), { width: 260, chars: 42 });
  const themedTooltip = tooltipTheme(isDark);
  const orderedCharts =
    planCharts?.map((chart) => chart.chart_key).filter(
      (chart): chart is "topic_area" | "emerging_topics" | "declining_topics" =>
        ["topic_area", "emerging_topics", "declining_topics"].includes(chart)
    ) ?? ["topic_area", "emerging_topics", "declining_topics"];
  const [treeN, setTreeN] = useState(30);
  const [view, setView] = useState<TimeView>("bars");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [tableFilter, setTableFilter] = useState("");

  // What was studied; method themes are shown on the Adaptive tab.
  const subjects = useMemo(() => subjectRows(trends), [trends]);
  const axis = useMemo(() => yearAxis(subjects.map((row) => row.year)), [subjects]);
  const undated = useMemo(() => undatedPaperCount(subjects), [subjects]);
  const paperIdsByKeyword = useMemo(() => paperIdsByKeywordKey(trends), [trends]);
  const themes = useMemo(() => {
    const rowsByTheme = new Map<string, TrendRow[]>();
    for (const row of subjects) rowsByTheme.set(row.topic, [...(rowsByTheme.get(row.topic) ?? []), row]);
    return themePaperCounts(subjects).map((entry) => {
      const rows = rowsByTheme.get(entry.topic) ?? [];
      return {
        ...entry,
        aliases: [...new Set(rows.map((row) => row.raw_topic ?? row.topic))].sort((a, b) => a.localeCompare(b)),
        keywords: keywordPaperCounts(rows).slice(0, 8).map((keyword) => keyword.keyword),
        years: [...new Set(rows.map((row) => row.year))].filter(isDatedYear).sort(),
      };
    });
  }, [subjects]);
  const shared = useMemo(() => themes.filter((entry) => entry.papers >= 2), [themes]);
  const shown = useMemo(() => {
    const present = new Set(shared.map((entry) => entry.topic));
    const chosen = (picked ?? shared.slice(0, DEFAULT_PICKED).map((entry) => entry.topic)).filter((topic) => present.has(topic));
    return chosen.slice(0, MAX_STACKED_SERIES);
  }, [picked, shared]);
  const colorOf = useMemo(() => seriesColors(shown, themeColors, isDark), [isDark, shown, themeColors]);
  const byYear = useMemo(() => themePapersByYear(subjects, shown, axis.years), [axis.years, shown, subjects]);
  const gridRows = useMemo(() => gridThemes(shown, byYear), [byYear, shown]);
  const shifts = useMemo(() => themeShifts(subjects), [subjects]);
  const treeData = useMemo(
    () =>
      themes.slice(0, treeN).map((entry) => ({
        name: entry.topic,
        value: entry.papers,
        paperIds: entry.paperIds,
        // Themes without a colour of their own are a quiet grey here, so the eight stand out.
        fill: hasThemeColor(themeColors, entry.topic) ? themeColor(themeColors, entry.topic, isDark) : isDark ? "#43474d" : "#c9ccd1",
      })),
    [isDark, themeColors, themes, treeN]
  );
  const visibleThemes = useMemo(() => {
    const normalized = tableFilter.trim().toLowerCase();
    if (!normalized) return themes;
    return themes.filter(
      (entry) =>
        entry.topic.toLowerCase().includes(normalized) ||
        entry.aliases.join(" ").toLowerCase().includes(normalized) ||
        entry.keywords.join(" ").toLowerCase().includes(normalized)
    );
  }, [tableFilter, themes]);

  if (trends.length === 0) {
    return (
      <div className="app-surface px-5 py-5">
        <p className="text-sm text-mute">No papers match the current filters.</p>
      </div>
    );
  }

  const periods = shifts.periods;
  const gaining = shifts.emerging.map((shift) => shift.topic);
  const losing = shifts.declining.map((shift) => shift.topic);
  // Three by name and a count of the rest: the sentence named three while the
  // chart below it drew four.
  const named = (topics: string[]) =>
    topics.length <= 3 ? listOf(topics) : `${topics.slice(0, 3).join(", ")} and ${plural(topics.length - 3, "other")}`;
  const takeaway = !periods
    ? "Too few dated years to compare periods: at least two are needed."
    : gaining.length + losing.length === 0
      ? `Comparing ${periods.earlyLabel} (${plural(periods.earlyPapers, "paper")}) with ${periods.lateLabel} (${periods.latePapers}), no theme has shifted by a paper or more beyond what the period sizes predict${shifts.judged === 0 ? ` - none yet has the ${SHIFT_MIN_PAPERS} papers a shift needs` : ""}.`
      : `Comparing ${periods.earlyLabel} (${plural(periods.earlyPapers, "paper")}) with ${periods.lateLabel} (${periods.latePapers}): ${
          gaining.length > 0 ? `${named(gaining)} ${gaining.length === 1 ? "is" : "are"} gaining ground` : ""
        }${gaining.length > 0 && losing.length > 0 ? "; " : ""}${
          losing.length > 0 ? `${named(losing)} ${losing.length === 1 ? "is" : "are"} losing it` : ""
        }.`;
  const key = colouredThemes(themeColors, isDark);
  // A theme without a colour of its own is a dashed grey line, told from another by its shade.
  const legendItems = shown.map((topic) => ({
    label: topic,
    color: colorOf[topic],
    dashed: view === "lines" && !hasThemeColor(themeColors, topic),
  }));
  const togglePicked = (topic: string) =>
    setPicked((current) => {
      const base = current ?? shown;
      if (base.includes(topic)) return base.filter((item) => item !== topic);
      return base.length >= MAX_STACKED_SERIES ? base : [...base, topic];
    });

  const shiftRows = (items: ThemeShift[]) =>
    items.slice(0, 8).map((shift) => ({
      topic: shift.topic,
      earlier: Math.round(shift.earlyShare * 1000) / 10,
      later: Math.round(shift.lateShare * 1000) / 10,
      early: shift.early,
      late: shift.late,
      paperIds: shift.paperIds,
    }));

  // Earlier in grey, later in the theme's own colour (ink for a theme without one).
  function renderShiftChart(title: string, items: ThemeShift[]) {
    const rows = shiftRows(items);
    if (rows.length === 0 || !periods) return null;
    return (
      <div className="min-w-0">
        <p className="mb-3 text-sm font-medium text-ink">{title}</p>
        <div style={{ height: rows.length * 56 + 36 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }} barGap={2}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={ct.grid} />
              <XAxis type="number" unit="%" tick={tickStyle(ct, 11)} stroke={ct.axisLine} />
              <YAxis
                type="category"
                dataKey="topic"
                width={shiftLabels.width}
                tick={wrappedTick(ct, shiftLabels.chars)}
                interval={0}
                stroke={ct.axisLine}
              />
              <Tooltip
                {...themedTooltip}
                formatter={(value, name, item) => {
                  const payload = (item as { payload?: { early: number; late: number } })?.payload;
                  const count = name === "earlier" ? payload?.early : payload?.late;
                  return [`${value}% (${plural(Number(count ?? 0), "paper")})`, name === "earlier" ? periods.earlyLabel : periods.lateLabel];
                }}
              />
              <Bar
                isAnimationActive={chartAnimationActive()}
                dataKey="earlier"
                fill={NEUTRAL_MARK}
                radius={[0, 4, 4, 0]}
                onClick={(entry) => {
                  const row = entry as { topic?: string; paperIds?: string[] };
                  if (row?.topic) onDrilldown?.({ topic: row.topic, paperIds: row.paperIds });
                }}
                className={onDrilldown ? "cursor-pointer" : undefined}
              />
              <Bar
                isAnimationActive={chartAnimationActive()}
                dataKey="later"
                radius={[0, 4, 4, 0]}
                onClick={(entry) => {
                  const row = entry as { topic?: string; paperIds?: string[] };
                  if (row?.topic) onDrilldown?.({ topic: row.topic, paperIds: row.paperIds });
                }}
                className={onDrilldown ? "cursor-pointer" : undefined}
              >
                {rows.map((row) => (
                  <Cell key={row.topic} fill={hasThemeColor(themeColors, row.topic) ? themeColor(themeColors, row.topic, isDark) : ct.barFill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ChartValues
          title={title}
          csv={{
            name: `${title} ${periods.earlyLabel} to ${periods.lateLabel}`,
            header: [
              "Theme",
              `Papers ${periods.earlyLabel}`,
              `Share ${periods.earlyLabel} (%)`,
              `Papers ${periods.lateLabel}`,
              `Share ${periods.lateLabel} (%)`,
            ],
            rows: rows.map((row) => [row.topic, row.early, row.earlier, row.late, row.later]),
          }}
          values={rows.map((row) => ({
            key: row.topic,
            label: row.topic,
            detail: `${periods.earlyLabel}: ${row.early}, ${periods.lateLabel}: ${row.late}`,
            onSelect: onDrilldown ? () => onDrilldown({ topic: row.topic, paperIds: row.paperIds }) : undefined,
          }))}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5">
        <h2 className="text-xl font-semibold text-ink">Themes</h2>
        <Takeaway>{takeaway}</Takeaway>
        {key.length > 0 ? (
          <div className="mt-4 border-t border-hairline pt-3" data-theme-key="">
            <p className="text-xs text-body">
              {key.length === 1 ? "The largest theme keeps" : `Each of the ${key.length} largest themes keeps`} its colour in every chart and in each paper&apos;s window. Other themes are grey.
            </p>
            <SeriesLegend items={[...key.map((item) => ({ label: item.theme, color: item.color })), { label: "Other themes", color: NEUTRAL_MARK }]} />
          </div>
        ) : null}
      </section>

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-ink">Theme sizes</h3>
          <label className="flex items-center gap-2 text-xs text-body">
            Themes shown: {Math.min(treeN, themes.length)}
            <input
              type="range"
              min={5}
              max={Math.max(5, Math.min(60, themes.length))}
              value={Math.min(treeN, Math.max(5, themes.length))}
              onChange={(event) => setTreeN(+event.target.value)}
              className="h-6 w-32"
            />
          </label>
        </div>
        <p className="mt-1 text-sm text-mute">Each rectangle is a theme, sized by its number of papers. Select one to see its papers.</p>
        {treeData.length > 0 ? (
          <div className="mt-4 h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={treeData}
                dataKey="value"
                nameKey="name"
                isAnimationActive={false}
                content={<TreemapCell x={0} y={0} width={0} height={0} name="" value={0} edge={ct.segmentEdge} onDrilldown={onDrilldown} />}
              />
            </ResponsiveContainer>
          </div>
        ) : null}
        <ChartValues
          title="Theme sizes"
          csv={{ name: "Theme sizes", header: ["Theme", "Papers"], rows: treeData.map((row) => [row.name, row.value]) }}
          values={treeData.map((row) => ({
            key: row.name,
            label: row.name,
            detail: paperCount(row.value),
            onSelect: onDrilldown ? () => onDrilldown({ topic: row.name, paperIds: row.paperIds }) : undefined,
          }))}
        />
      </section>

      {orderedCharts.includes("topic_area") ? (
        <section className="app-surface px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-ink">Themes over time</h3>
            <div role="group" aria-label="Show as" className="inline-flex rounded-lg bg-subtle p-0.5">
              {TIME_VIEWS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={view === option.value}
                  onClick={() => setView(option.value)}
                  className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                    view === option.value
                      ? "bg-white text-ink shadow-sm dark:bg-[#292929]"
                      : "text-body hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm text-mute">
            Papers per year in the themes you pick, up to {MAX_STACKED_SERIES}. The {DEFAULT_PICKED} largest shared themes are shown until you choose. Every year in the range has a slot, so a year with no papers shows as a gap.
          </p>
          {shared.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Themes to compare">
              {shared.slice(0, PICKABLE_THEMES).map((entry) => {
                const on = shown.includes(entry.topic);
                const color = themeColor(themeColors, entry.topic, isDark);
                return (
                  <button
                    key={entry.topic}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePicked(entry.topic)}
                    disabled={!on && shown.length >= MAX_STACKED_SERIES}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      on
                        ? "border-slate-900 font-medium text-ink dark:border-white"
                        : "border-hairline bg-surface text-ink hover:border-slate-300 dark:hover:border-[#3a3a3a]"
                    }`}
                    style={on ? { backgroundColor: tint(color, isDark ? 0.22 : 0.12) } : undefined}
                  >
                    <Dot color={color} />
                    {entry.topic}
                  </button>
                );
              })}
              {picked ? (
                <button type="button" onClick={() => setPicked(null)} className="min-h-9 px-2 text-xs font-medium text-body underline-offset-4 hover:underline">
                  Back to the {DEFAULT_PICKED} largest
                </button>
              ) : null}
            </div>
          ) : null}
          {shown.length === 0 || axis.years.length === 0 ? (
            <p className="mt-4 text-sm text-body">
              {shared.length === 0
                ? "No theme is shared by two or more papers in the current filters, so there is no trend to draw."
                : "Pick a theme to draw it."}
            </p>
          ) : view === "grid" ? (
            <div className="mt-5">
              <Heatmap
                rows={gridRows}
                cols={axis.years}
                values={gridRows.map((topic) => byYear.map((row) => Number(row[topic] ?? 0)))}
                rowColors={gridRows.map((topic) => colorOf[topic])}
                colorScale={ct.heatScaleAccent}
                hideZeros
              />
              {gridRows.length < shown.length ? (
                <p className="mt-2 text-xs leading-5 text-body">
                  {plural(shown.length - gridRows.length, "picked theme")} {shown.length - gridRows.length === 1 ? "has" : "have"} papers only without a readable year, so {shown.length - gridRows.length === 1 ? "it is" : "they are"} not drawn.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mt-5 h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  {view === "bars" ? (
                    <BarChart data={byYear}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                      <Tooltip {...themedTooltip} />
                      {shown.map((topic) => (
                        <Bar
                          isAnimationActive={chartAnimationActive()}
                          key={topic}
                          dataKey={topic}
                          stackId="themes"
                          fill={colorOf[topic]}
                          stroke={ct.segmentEdge}
                          strokeWidth={1}
                          onClick={(entry) => {
                            const year = entry && "year" in entry ? String(entry.year) : undefined;
                            onDrilldown?.({ topic, year, paperIds: markPaperIds(entry, topic) });
                          }}
                          className={onDrilldown ? "cursor-pointer" : undefined}
                        />
                      ))}
                    </BarChart>
                  ) : (
                    <LineChart data={byYear}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                      <Tooltip {...themedTooltip} />
                      {shown.map((topic, index) => (
                        <Line
                          isAnimationActive={chartAnimationActive()}
                          key={topic}
                          type="linear"
                          dataKey={topic}
                          stroke={colorOf[topic]}
                          strokeWidth={2}
                          strokeDasharray={legendItems[index]?.dashed ? "5 4" : undefined}
                          dot={{ r: 3 }}
                        />
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              <SeriesLegend items={legendItems} />
            </>
          )}
          <ChartValues
            title="Themes over time"
            csv={{ name: "Themes over time", ...seriesTable(byYear, "year", shown.map((topic) => ({ key: topic, label: topic }))) }}
            values={byYear.flatMap((row) =>
              shown
                .filter((topic) => Number(row[topic] ?? 0) > 0)
                .map((topic) => ({
                  key: `${row.year}:${topic}`,
                  group: String(row.year),
                  label: topic,
                  detail: paperCount(Number(row[topic])),
                  onSelect: onDrilldown ? () => onDrilldown({ topic, year: String(row.year), paperIds: markPaperIds(row, topic) }) : undefined,
                }))
            )}
          />
          {axis.empty.length > 0 || undated > 0 ? (
            <p className="mt-2 text-xs leading-5 text-body">
              {axis.empty.length > 0 ? `No papers from ${listOf(axis.empty)}. ` : ""}
              {undated > 0 ? `${plural(undated, "paper")} without a readable year ${undated === 1 ? "is" : "are"} not drawn.` : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {orderedCharts.includes("emerging_topics") || orderedCharts.includes("declining_topics") ? (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-ink">Gaining and losing ground</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-mute">
            {periods
              ? `The collection split where its dated papers halve: ${periods.earlyLabel} (${periods.earlyPapers} papers) and ${periods.lateLabel} (${periods.latePapers}). A theme is shown when it has at least ${SHIFT_MIN_PAPERS} papers, has at least one paper more (or fewer) in the later period than the two period sizes alone predict, and would still lean the same way if any one of its papers were removed. Bars show each theme's share of each period's papers.`
              : "Needs papers from at least two different years."}
          </p>
          {periods && shifts.emerging.length + shifts.declining.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink" data-period-legend="">
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: NEUTRAL_MARK }} />
                {periods.earlyLabel} ({plural(periods.earlyPapers, "paper")})
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-flex h-2.5 w-4 overflow-hidden rounded-sm">
                  {(key.length > 0 ? key.slice(0, 4) : [{ theme: "", color: ct.barFill }]).map((item) => (
                    <span key={item.theme || "ink"} className="h-full flex-1" style={{ backgroundColor: item.color }} />
                  ))}
                </span>
                {periods.lateLabel} ({plural(periods.latePapers, "paper")}), in each theme&apos;s colour
              </li>
            </ul>
          ) : null}
          {shifts.emerging.length + shifts.declining.length > 0 ? (
            <div className={`mt-5 grid gap-6 ${shifts.emerging.length > 0 && shifts.declining.length > 0 ? "xl:grid-cols-2" : ""}`}>
              {orderedCharts.includes("emerging_topics") ? renderShiftChart("Gaining ground", shifts.emerging) : null}
              {orderedCharts.includes("declining_topics") ? renderShiftChart("Losing ground", shifts.declining) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-body">
              {periods
                ? shifts.judged === 0
                  ? `No theme has the ${SHIFT_MIN_PAPERS} or more papers needed to judge a shift.`
                  : `Of ${plural(shifts.judged, "theme")} with ${SHIFT_MIN_PAPERS} or more papers, none has shifted by a paper or more beyond what the period sizes predict. That is itself a finding: the themes here are holding steady.`
                : "There is only one dated year in the current filters."}
            </p>
          )}
        </section>
      ) : null}

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">Themes and what they gather</h3>
            <p className="mt-1 text-sm text-mute">
              Each theme, the topic labels its papers were given, and the keywords most of its papers use.
            </p>
          </div>
          <input
            type="search"
            value={tableFilter}
            onChange={(event) => setTableFilter(event.target.value)}
            placeholder="Filter themes"
            aria-label="Filter themes"
            className="h-9 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-base text-ink placeholder:text-mute focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:w-56 sm:text-sm"
          />
        </div>
        <div className="mt-4 max-h-[460px] overflow-auto rounded-xl border border-hairline">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-canvas">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Theme</th>
                <th className="px-3 py-2 text-right font-semibold">Papers</th>
                <th className="px-3 py-2 text-left font-semibold">Years</th>
                <th className="px-3 py-2 text-left font-semibold">Paper labels and keywords</th>
              </tr>
            </thead>
            <tbody>
              {visibleThemes.map((row) => {
                const color = themeColor(themeColors, row.topic, isDark);
                return (
                  <tr key={row.topic} className="border-t border-hairline align-top hover:bg-subtle">
                    <td className="px-3 py-2 font-medium text-ink">
                      <span className="flex items-start gap-2">
                        <span className="mt-1">
                          <Dot color={color} />
                        </span>
                        <button
                          type="button"
                          onClick={() => onDrilldown?.({ topic: row.topic, paperIds: row.paperIds })}
                          className="-my-1 py-1 text-left font-semibold text-ink underline-offset-4 transition-colors hover:text-body hover:underline disabled:cursor-default disabled:no-underline"
                          disabled={!onDrilldown}
                          title="Open the papers in this theme"
                        >
                          {row.topic}
                        </button>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.papers}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-body">
                      {row.years.length === 0 ? "No dated papers" : row.years.length === 1 ? row.years[0] : `${row.years[0]}–${row.years[row.years.length - 1]}`}
                    </td>
                    <td className="max-w-md px-3 py-2 text-body">
                      <div className="space-y-2">
                        {row.aliases.length > 1 || row.aliases[0] !== row.topic ? <p className="text-xs leading-5">{row.aliases.join("; ")}</p> : null}
                        {row.keywords.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {row.keywords.map((keyword) => (
                              <button
                                key={`${row.topic}-${keyword}`}
                                type="button"
                                onClick={() => onDrilldown?.({ keyword, paperIds: [...(paperIdsByKeyword.get(keywordKey(keyword)) ?? [])] })}
                                className="rounded-full border px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:text-ink disabled:cursor-default"
                                style={{ backgroundColor: tint(color, isDark ? 0.18 : 0.1), borderColor: tint(color, isDark ? 0.5 : 0.35) }}
                                disabled={!onDrilldown}
                                title="Open papers for this keyword"
                              >
                                {keyword}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end">
          <ChartCsvButton
            csv={{
              name: "Themes and what they gather",
              header: ["Theme", "Papers", "First year", "Last year", "Paper labels", "Keywords"],
              rows: visibleThemes.map((row) => [
                row.topic,
                row.papers,
                row.years[0] ?? "",
                row.years[row.years.length - 1] ?? "",
                row.aliases.join("; "),
                row.keywords.join("; "),
              ]),
            }}
          />
        </div>
      </section>
    </div>
  );
}

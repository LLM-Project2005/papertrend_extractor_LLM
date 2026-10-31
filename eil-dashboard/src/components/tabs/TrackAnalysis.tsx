"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Heatmap from "@/components/Heatmap";
import {
  TRACK_COLS,
  TRACK_COLORS,
  TRACK_NAMES,
  type TrackKey,
} from "@/lib/constants";
import {
  normalizeCategoryKey,
  type CategoryOption,
} from "@/lib/category-options";
import type { CategoryAssignmentRow, PaperId, TrendRow, TrackRow } from "@/types/database";
import type { VisualizationPlanChart } from "@/types/visualization";
import { useTheme } from "@/components/theme/ThemeProvider";
import { chartTheme, tickStyle, chartAnimationActive } from "@/lib/chart-theme";
import { legendLabel } from "@/lib/chart-legend";
import { isDatedYear } from "@/lib/dated-year";
import { CategoriesOffNotice, Takeaway } from "@/components/dashboard/DashboardNotes";
import { plural, subjectRows, yearAxis } from "@/lib/dashboard-analytics";
import { idsKey, markPaperIds } from "@/lib/dashboard-drilldown";
import ChartValues, { paperCount } from "@/components/tabs/ChartValues";
import ChartCsvButton from "@/components/tabs/ChartCsvButton";
import { seriesTable } from "@/lib/chart-csv";
import { tooltipTheme } from "@/lib/chart-tooltip";
import { wrappedTick } from "@/lib/chart-ticks";
import { NO_THEME_COLORS, themeColor, type ThemeColors } from "@/lib/theme-colors";

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
  /** The repository's theme colours: the top themes per research area wear them. */
  themeColors?: ThemeColors;
  planCharts?: VisualizationPlanChart[];
  onDrilldown?: (target: {
    track?: string;
    year?: string;
    topic?: string;
    keyword?: string;
    paperIds?: string[];
  }) => void;
}

const trackField = (track: string) =>
  track.toLowerCase() as "el" | "eli" | "lae" | "other";

export default function TrackAnalysis({
  trends,
  tracksSingle,
  tracksMulti,
  categoryAssignments = [],
  categoryOptions = [],
  selectedTracks,
  categoryLabels,
  classificationEnabled = true,
  themeColors = NO_THEME_COLORS,
  planCharts,
  onDrilldown,
}: Props) {
  const { theme, hydrated } = useTheme();
  const ct = chartTheme(hydrated && theme === "dark");
  const themedTooltip = tooltipTheme(hydrated && theme === "dark");
  const orderedCharts =
    planCharts?.map((chart) => chart.chart_key).filter(
      (
        chart
      ): chart is "track_year_stacked" | "track_cooccurrence" | "topics_per_track" =>
        ["track_year_stacked", "track_cooccurrence", "topics_per_track"].includes(chart)
    ) ?? ["track_year_stacked", "track_cooccurrence", "topics_per_track"];
  const trackYearConfig = planCharts?.find(
    (chart) => chart.chart_key === "track_year_stacked"
  )?.config;
  const topicsPerTrackConfig = planCharts?.find(
    (chart) => chart.chart_key === "topics_per_track"
  )?.config;
  const stackedTracks = trackYearConfig?.selected_tracks ?? selectedTracks;
  const topicTracks = topicsPerTrackConfig?.selected_tracks ?? selectedTracks;
  const topicsPerTrackLimit = topicsPerTrackConfig?.top_n ?? 8;
  const hasDynamicCategories = categoryAssignments.length > 0 && categoryOptions.length > 0;
  const activeCategories = useMemo(() => {
    if (!hasDynamicCategories) {
      return [];
    }
    const optionKeys = new Set(categoryOptions.map((category) => category.key));
    const selectedKeys = stackedTracks
      .map((track) => normalizeCategoryKey(track))
      .filter((track) => optionKeys.has(track));
    const activeKeys = new Set(selectedKeys.length > 0 ? selectedKeys : [...optionKeys]);
    return categoryOptions.filter((category) => activeKeys.has(category.key));
  }, [categoryOptions, hasDynamicCategories, stackedTracks]);
  const activeTopicCategories = useMemo(() => {
    if (!hasDynamicCategories) {
      return [];
    }
    const optionKeys = new Set(categoryOptions.map((category) => category.key));
    const selectedKeys = topicTracks
      .map((track) => normalizeCategoryKey(track))
      .filter((track) => optionKeys.has(track));
    const activeKeys = new Set(selectedKeys.length > 0 ? selectedKeys : [...optionKeys]);
    return categoryOptions.filter((category) => activeKeys.has(category.key));
  }, [categoryOptions, hasDynamicCategories, topicTracks]);

  const stackedData = useMemo(() => {
    if (hasDynamicCategories) {
      const years = [
        ...new Set(
          categoryAssignments
            .filter((row) => row.assignment_type === "single")
            .map((row) => row.year)
        ),
      ]
        .filter(isDatedYear)
        .sort();
      return yearAxis(years).years.map((year) => {
        const entry: Record<string, string | number | string[]> = { year };
        activeCategories.forEach((category) => {
          const papers = new Set(
            categoryAssignments
              .filter(
                (row) =>
                  row.assignment_type === "single" &&
                  row.year === year &&
                  normalizeCategoryKey(row.category_key) === category.key
              )
              .map((row) => row.paper_id)
          );
          entry[category.key] = papers.size;
          entry[idsKey(category.key)] = [...papers];
        });
        return entry;
      });
    }

    const years = [...new Set(tracksSingle.map((row) => row.year))].filter(isDatedYear).sort();
    return yearAxis(years).years.map((year) => {
      const entry: Record<string, string | number | string[]> = { year };
      const yearRows = tracksSingle.filter((row) => row.year === year);
      TRACK_COLS.filter((track) => stackedTracks.includes(track)).forEach((track) => {
        entry[track] = yearRows.reduce((sum, row) => sum + row[trackField(track)], 0);
        entry[idsKey(track)] = yearRows.filter((row) => row[trackField(track)] > 0).map((row) => row.paper_id);
      });
      return entry;
    });
  }, [activeCategories, categoryAssignments, hasDynamicCategories, stackedTracks, tracksSingle]);

  const coMatrix = useMemo(
    () => {
      if (hasDynamicCategories) {
        const multiByPaper = categoryAssignments
          .filter((row) => row.assignment_type === "multi")
          .reduce<Record<string, Set<string>>>((accumulator, row) => {
            const set = accumulator[row.paper_id] ?? new Set<string>();
            set.add(normalizeCategoryKey(row.category_key));
            accumulator[row.paper_id] = set;
            return accumulator;
          }, {});
        return activeTopicCategories.map((leftCategory) =>
          activeTopicCategories.map((rightCategory) =>
            Object.values(multiByPaper).reduce(
              (sum, categorySet) =>
                sum + (categorySet.has(leftCategory.key) && categorySet.has(rightCategory.key) ? 1 : 0),
              0
            )
          )
        );
      }

      return TRACK_COLS.filter((track) => topicTracks.includes(track)).map((leftTrack) =>
        TRACK_COLS.filter((track) => topicTracks.includes(track)).map((rightTrack) =>
          tracksMulti.reduce(
            (sum, row) =>
              sum +
              (row[trackField(leftTrack)] === 1 && row[trackField(rightTrack)] === 1
                ? 1
                : 0),
            0
          )
        )
      );
    },
    [activeTopicCategories, categoryAssignments, hasDynamicCategories, topicTracks, tracksMulti]
  );

  const topicsPerTrack = useMemo(() => {
    if (hasDynamicCategories) {
      const categorySetsByPaper = categoryAssignments
        .filter((row) => row.assignment_type === "single")
        .reduce<Record<string, Set<string>>>((accumulator, row) => {
          const set = accumulator[row.paper_id] ?? new Set<string>();
          set.add(normalizeCategoryKey(row.category_key));
          accumulator[row.paper_id] = set;
          return accumulator;
        }, {});
      const result: Record<string, { topic: string; papers: number; paperIds: string[] }[]> = {};

      activeTopicCategories.forEach((category) => {
        const counts: Record<string, Set<PaperId>> = {};
        subjectRows(trends).forEach((row) => {
          const paperCategories = categorySetsByPaper[row.paper_id];
          if (paperCategories?.has(category.key)) {
            (counts[row.topic] ??= new Set()).add(row.paper_id);
          }
        });
        result[category.key] = Object.entries(counts)
          .map(([topic, ids]) => ({ topic, papers: ids.size, paperIds: [...ids] }))
          .sort((left, right) => right.papers - left.papers)
          .slice(0, topicsPerTrackLimit);
      });

      return result;
    }

    const trackMap = new Map(tracksSingle.map((row) => [row.paper_id, row]));
    const result: Record<string, { topic: string; papers: number; paperIds: string[] }[]> = {};

    TRACK_COLS.filter((track) => topicTracks.includes(track)).forEach((track) => {
      const counts: Record<string, Set<PaperId>> = {};
      subjectRows(trends).forEach((row) => {
        const trackRow = trackMap.get(row.paper_id);
        if (trackRow && trackRow[trackField(track)] === 1) {
          (counts[row.topic] ??= new Set()).add(row.paper_id);
        }
      });

      result[track] = Object.entries(counts)
        .map(([topic, ids]) => ({ topic, papers: ids.size, paperIds: [...ids] }))
        .sort((left, right) => right.papers - left.papers)
        .slice(0, topicsPerTrackLimit);
    });

    return result;
  }, [
    activeTopicCategories,
    categoryAssignments,
    hasDynamicCategories,
    topicTracks,
    topicsPerTrackLimit,
    tracksSingle,
    trends,
  ]);
  const legacyStackedCategories = TRACK_COLS.filter((track) => stackedTracks.includes(track)).map((track) => ({
    key: track,
    label: categoryLabels?.[track as TrackKey] || track,
    description: TRACK_NAMES[track as TrackKey],
    color: TRACK_COLORS[track as TrackKey],
  }));
  const legacyTopicCategories = TRACK_COLS.filter((track) => topicTracks.includes(track)).map((track) => ({
    key: track,
    label: categoryLabels?.[track as TrackKey] || track,
    description: TRACK_NAMES[track as TrackKey],
    color: TRACK_COLORS[track as TrackKey],
  }));
  const stackedChartCategories = hasDynamicCategories ? activeCategories : legacyStackedCategories;
  const topicChartCategories = hasDynamicCategories ? activeTopicCategories : legacyTopicCategories;
  const categoryByKey = new Map(
    [...stackedChartCategories, ...topicChartCategories].map((category) => [category.key, category])
  );

  if (!classificationEnabled) {
    return (
      <div className="space-y-6">
        <section className="app-surface px-5 py-5">
          <h2 className="text-xl font-semibold text-ink">Research areas</h2>
          <Takeaway>Nothing to show: this repository does not sort papers into research areas.</Takeaway>
        </section>
        <CategoriesOffNotice />
      </div>
    );
  }

  // Per-category paper totals across the years drawn, for the one-line summary.
  const categoryTotals = stackedChartCategories
    .map((category) => ({
      label: category.label,
      papers: stackedData.reduce((sum, entry) => sum + Number(entry[category.key] ?? 0), 0),
    }))
    .sort((left, right) => right.papers - left.papers);
  const classifiedPapers = categoryTotals.reduce((sum, entry) => sum + entry.papers, 0);
  const lead = categoryTotals[0];

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5">
        <h2 className="text-xl font-semibold text-ink">
          Research areas
        </h2>
        {lead && classifiedPapers > 0 ? (
          <Takeaway>
            {`${lead.label} holds the most papers: ${plural(lead.papers, "paper")}, ${Math.round((lead.papers / classifiedPapers) * 100)}% of the ${classifiedPapers} with a dated research area.`}
            {categoryTotals.length > 1 && categoryTotals[1].papers > 0
              ? ` Next is ${categoryTotals[1].label} with ${categoryTotals[1].papers}.`
              : ""}
          </Takeaway>
        ) : (
          <Takeaway>No paper in the current filters has a research area yet.</Takeaway>
        )}
      </section>

      {orderedCharts.includes("track_year_stacked") && stackedData.length > 0 && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-ink">
            Papers per research area per year
          </h3>
          <div className="mt-4 h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <Tooltip {...themedTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendLabel(ct)} />
                {stackedChartCategories.map((category) => (
                  <Bar isAnimationActive={chartAnimationActive()}
                    key={category.key}
                    dataKey={category.key}
                    name={category.label}
                    stackId="tracks"
                    fill={category.color}
                    onClick={(entry) => {
                      if (entry && "year" in entry) {
                        onDrilldown?.({ track: category.key, year: String(entry.year), paperIds: markPaperIds(entry, category.key) });
                      }
                    }}
                    className={onDrilldown ? "cursor-pointer" : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartValues
            title="Papers per research area per year"
            csv={{
              name: "Papers per research area per year",
              ...seriesTable(
                stackedData as Array<Record<string, unknown>>,
                "year",
                stackedChartCategories.map((category) => ({ key: category.key, label: category.label }))
              ),
            }}
            values={stackedData.flatMap((row) =>
              stackedChartCategories
                .filter((category) => Number((row as Record<string, unknown>)[category.key] ?? 0) > 0)
                .map((category) => ({
                  key: `${row.year}:${category.key}`,
                  group: String(row.year),
                  label: category.label,
                  detail: paperCount(Number((row as Record<string, unknown>)[category.key])),
                  onSelect: onDrilldown
                    ? () => onDrilldown({ track: category.key, year: String(row.year), paperIds: markPaperIds(row, category.key) })
                    : undefined,
                }))
            )}
          />
        </section>
      )}

      {orderedCharts.includes("track_cooccurrence") && coMatrix.length > 0 && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-ink">
            Research area co-occurrence
          </h3>
          <p className="mt-1 text-sm text-mute">
            How often research areas appear together on the same paper. The diagonal counts each area&apos;s own papers.
          </p>
          <div className="mt-4">
            <Heatmap
              rows={topicChartCategories.map((category) => category.label)}
              cols={topicChartCategories.map((category) => category.label)}
              values={coMatrix}
              colorScale={ct.heatScaleAccent}
              columnWidth="7rem"
              hideZeros
            />
          </div>
          <div className="mt-3 flex justify-end">
            <ChartCsvButton
              csv={{
                name: "Research area co-occurrence",
                header: ["Research area", ...topicChartCategories.map((category) => category.label)],
                rows: topicChartCategories.map((category, index) => [category.label, ...(coMatrix[index] ?? [])]),
              }}
            />
          </div>
        </section>
      )}

      {orderedCharts.includes("topics_per_track") &&
      Object.keys(topicsPerTrack).length > 0 ? (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-ink">
            Top themes per research area
          </h3>
          <p className="mt-1 text-sm text-mute">
            The themes most papers in each research area take up, in each theme&apos;s colour.
          </p>
          {/* A research area with no paper in the filters took a quarter of the
              card to say so (2026-10-24 review); it is named in one line instead. */}
          {Object.entries(topicsPerTrack).some(([, data]) => data.length === 0) ? (
            <p className="mt-2 text-xs text-body">
              No papers in the current filters for{" "}
              {Object.entries(topicsPerTrack)
                .filter(([, data]) => data.length === 0)
                .map(([track]) => categoryByKey.get(track)?.label ?? track)
                .join(", ")}
              .
            </p>
          ) : null}
          <div
            className="mt-5 grid gap-8"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            }}
          >
            {Object.entries(topicsPerTrack).filter(([, data]) => data.length > 0).map(([track, data]) => {
              const category = categoryByKey.get(track) ?? {
                key: track,
                label: track,
                description: "",
                color: TRACK_COLORS.Other,
              };

              return (
                <div key={track} className="min-w-0">
                  {/* No research-area colour here: the bars are themes, and
                      one card means one thing by its colours. */}
                  <p className="mb-3 text-sm font-semibold text-ink">
                    <span>{category.label}</span>
                    {category.description ? (
                      <span className="ml-2 font-normal text-mute">
                        {category.description}
                      </span>
                    ) : null}
                  </p>
                  {data.length > 0 ? (
                    <div style={{ height: data.length * 36 + 16 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
                          <XAxis type="number" tick={tickStyle(ct, 10)} hide />
                          <YAxis
                            type="category"
                            dataKey="topic"
                            width={170}
                            tick={wrappedTick(ct, 28, 10)}
                            interval={0}
                            stroke={ct.axisLine}
                          />
                          <Tooltip {...themedTooltip} />
                          <Bar isAnimationActive={chartAnimationActive()}
                            dataKey="papers"
                            radius={[0, 6, 6, 0]}
                            barSize={16}
                            onClick={(entry) => {
                              if (entry && "topic" in entry) {
                                onDrilldown?.({
                                  track,
                                  topic: String(entry.topic),
                                  paperIds: markPaperIds(entry),
                                });
                              }
                            }}
                            className={onDrilldown ? "cursor-pointer" : undefined}
                          >
                            {data.map((row) => (
                              <Cell key={row.topic} fill={themeColor(themeColors, row.topic, hydrated && theme === "dark")} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <ChartValues
                        title={category.label}
                        csv={{
                          name: `Themes in ${category.label}`,
                          header: ["Theme", "Papers"],
                          rows: data.map((row) => [String(row.topic), Number(row.papers)]),
                        }}
                        values={data.map((row) => ({
                          key: String(row.topic),
                          label: String(row.topic),
                          detail: paperCount(Number(row.papers)),
                          onSelect: onDrilldown
                            ? () => onDrilldown({ track, topic: String(row.topic), paperIds: markPaperIds(row) })
                            : undefined,
                        }))}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-mute">No papers in this research area match the current filters.</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

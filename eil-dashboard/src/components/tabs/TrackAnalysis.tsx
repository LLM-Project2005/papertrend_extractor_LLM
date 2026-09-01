"use client";

import { useMemo } from "react";
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

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  categoryAssignments?: CategoryAssignmentRow[];
  categoryOptions?: CategoryOption[];
  selectedTracks: string[];
  categoryLabels?: Record<TrackKey, string>;
  planCharts?: VisualizationPlanChart[];
  onDrilldown?: (target: {
    track?: string;
    year?: string;
    topic?: string;
    keyword?: string;
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
  planCharts,
  onDrilldown,
}: Props) {
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
      ].sort();
      return years.map((year) => {
        const entry: Record<string, string | number> = { year };
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
        });
        return entry;
      });
    }

    const years = [...new Set(tracksSingle.map((row) => row.year))].sort();
    return years.map((year) => {
      const entry: Record<string, string | number> = { year };
      const yearRows = tracksSingle.filter((row) => row.year === year);
      TRACK_COLS.filter((track) => stackedTracks.includes(track)).forEach((track) => {
        entry[track] = yearRows.reduce((sum, row) => sum + row[trackField(track)], 0);
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
      const result: Record<string, { topic: string; papers: number }[]> = {};

      activeTopicCategories.forEach((category) => {
        const counts: Record<string, Set<PaperId>> = {};
        trends.forEach((row) => {
          const paperCategories = categorySetsByPaper[row.paper_id];
          if (paperCategories?.has(category.key)) {
            (counts[row.topic] ??= new Set()).add(row.paper_id);
          }
        });
        result[category.key] = Object.entries(counts)
          .map(([topic, ids]) => ({ topic, papers: ids.size }))
          .sort((left, right) => right.papers - left.papers)
          .slice(0, topicsPerTrackLimit);
      });

      return result;
    }

    const trackMap = new Map(tracksSingle.map((row) => [row.paper_id, row]));
    const result: Record<string, { topic: string; papers: number }[]> = {};

    TRACK_COLS.filter((track) => topicTracks.includes(track)).forEach((track) => {
      const counts: Record<string, Set<PaperId>> = {};
      trends.forEach((row) => {
        const trackRow = trackMap.get(row.paper_id);
        if (trackRow && trackRow[trackField(track)] === 1) {
          (counts[row.topic] ??= new Set()).add(row.paper_id);
        }
      });

      result[track] = Object.entries(counts)
        .map(([topic, ids]) => ({ topic, papers: ids.size }))
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

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Category analysis
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Review category balance, overlap, and the topic clusters most tied to each category.
        </p>
      </section>

      {orderedCharts.includes("track_year_stacked") && stackedData.length > 0 && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Papers per category per year
          </h3>
          <div className="mt-4 h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {stackedChartCategories.map((category) => (
                  <Bar
                    key={category.key}
                    dataKey={category.key}
                    name={category.label}
                    stackId="tracks"
                    fill={category.color}
                    onClick={(entry) => {
                      if (entry && "year" in entry) {
                        onDrilldown?.({ track: category.key, year: String(entry.year) });
                      }
                    }}
                    className={onDrilldown ? "cursor-pointer" : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {orderedCharts.includes("track_cooccurrence") && coMatrix.length > 0 && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Category co-occurrence
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            How often categories appear together on the same paper.
          </p>
          <div className="mt-4">
            <Heatmap
              rows={topicChartCategories.map((category) => category.label)}
              cols={topicChartCategories.map((category) => category.label)}
              values={coMatrix}
              colorScale={["#eff6ff", "#1e40af"]}
            />
          </div>
        </section>
      )}

      {orderedCharts.includes("topics_per_track") &&
      Object.keys(topicsPerTrack).length > 0 ? (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Top topics per category
          </h3>
          <div
            className="mt-5 grid gap-6"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            }}
          >
            {Object.entries(topicsPerTrack).map(([track, data]) => {
              const category = categoryByKey.get(track) ?? {
                key: track,
                label: track,
                description: "",
                color: TRACK_COLORS.Other,
              };

              return (
                <div key={track}>
                  <p className="mb-3 text-sm font-medium text-slate-900 dark:text-white">
                    <span style={{ color: category.color }}>{category.label}</span>
                    {category.description ? (
                      <span className="ml-2 text-slate-500 dark:text-slate-400">
                        {category.description}
                      </span>
                    ) : null}
                  </p>
                  {data.length > 0 ? (
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} hide />
                          <YAxis
                            type="category"
                            dataKey="topic"
                            width={150}
                            tick={{ fontSize: 10 }}
                            stroke="#94a3b8"
                          />
                          <Tooltip />
                          <Bar
                            dataKey="papers"
                            fill={category.color}
                            radius={[0, 6, 6, 0]}
                            barSize={16}
                            onClick={(entry) => {
                              if (entry && "topic" in entry) {
                                onDrilldown?.({
                                  track,
                                  topic: String(entry.topic),
                                });
                              }
                            }}
                            className={onDrilldown ? "cursor-pointer" : undefined}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No data</p>
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

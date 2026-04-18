"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Heatmap from "@/components/Heatmap";
import { TOPIC_PALETTE, TRACK_COLORS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import type { DashboardData, PaperId, TrendRow, TrackRow } from "@/types/database";
import type { VisualizationPlanSection } from "@/types/visualization";

function toTrackField(track: string) {
  return track.toLowerCase() as keyof TrackRow;
}

function ChartShell({
  title,
  reason,
  children,
}: {
  title: string;
  reason: string;
  children: ReactNode;
}) {
  return (
    <section className="app-surface px-5 py-5">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{reason}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function AdaptiveDashboardTab({
  data,
  adaptiveSection,
  folderNamesById,
}: {
  data: Pick<DashboardData, "trends" | "tracksSingle" | "tracksMulti" | "topicFamilies">;
  adaptiveSection: VisualizationPlanSection;
  folderNamesById: Record<string, string>;
}) {
  const years = [...new Set(data.trends.map((row) => row.year))].sort();
  const singleTrackByPaper = new Map(data.tracksSingle.map((row) => [row.paper_id, row]));

  function renderChart(
    chart: VisualizationPlanSection["charts"][number]
  ): ReactNode | null {
    if (chart.chart_key === "adaptive_topic_momentum") {
      const topicLimit = chart.config?.top_n ?? 6;
      const topTopics = Object.entries(
        data.trends.reduce<Record<string, Set<PaperId>>>((accumulator, row) => {
          (accumulator[row.topic] ??= new Set()).add(row.paper_id);
          return accumulator;
        }, {})
      )
        .sort((left, right) => right[1].size - left[1].size)
        .slice(0, topicLimit)
        .map(([topic]) => topic);
      if (topTopics.length === 0) {
        return null;
      }

      const chartData = years.map((year) => {
        const entry: Record<string, string | number> = { year };
        topTopics.forEach((topic) => {
          entry[topic] = new Set(
            data.trends
              .filter((row) => row.year === year && row.topic === topic)
              .map((row) => row.paper_id)
          ).size;
        });
        return entry;
      });

      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {topTopics.map((topic, index) => (
                  <Line
                    key={topic}
                    type="monotone"
                    dataKey={topic}
                    stroke={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                    strokeWidth={3}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartShell>
      );
    }

    if (chart.chart_key === "adaptive_emerging_topics") {
      const topicLimit = chart.config?.top_n ?? 8;
      if (years.length < 2) {
        return null;
      }

      const midpoint = Math.floor(years.length / 2);
      const earlyYears = new Set(years.slice(0, midpoint));
      const lateYears = new Set(years.slice(midpoint));
      const topicShiftData = Object.entries(
        data.trends.reduce<Record<string, { early: Set<PaperId>; late: Set<PaperId> }>>(
          (accumulator, row) => {
            const entry = (accumulator[row.topic] ??= {
              early: new Set<PaperId>(),
              late: new Set<PaperId>(),
            });
            if (earlyYears.has(row.year)) {
              entry.early.add(row.paper_id);
            }
            if (lateYears.has(row.year)) {
              entry.late.add(row.paper_id);
            }
            return accumulator;
          },
          {}
        )
      )
        .map(([topic, value]) => ({
          topic,
          change: value.late.size - value.early.size,
        }))
        .filter((row) => row.change !== 0)
        .sort((left, right) => Math.abs(right.change) - Math.abs(left.change))
        .slice(0, topicLimit);

      if (topicShiftData.length === 0) {
        return null;
      }

      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topicShiftData} layout="vertical" margin={{ left: 16, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis
                  type="category"
                  dataKey="topic"
                  width={190}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <Tooltip />
                <Bar
                  dataKey="change"
                  fill="#2563eb"
                  radius={[0, 8, 8, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartShell>
      );
    }

    if (chart.chart_key === "adaptive_folder_topic_comparison") {
      const topicLimit = chart.config?.top_n ?? 6;
      const folders = [...new Set(data.trends.map((row) => row.folder_id).filter(Boolean))];
      if (folders.length < 2) {
        return null;
      }

      const topTopics = Object.entries(
        data.trends.reduce<Record<string, Set<PaperId>>>((accumulator, row) => {
          (accumulator[row.topic] ??= new Set()).add(row.paper_id);
          return accumulator;
        }, {})
      )
        .sort((left, right) => right[1].size - left[1].size)
        .slice(0, topicLimit)
        .map(([topic]) => topic);
      if (topTopics.length === 0) {
        return null;
      }

      const chartData = topTopics.map((topic) => {
        const entry: Record<string, string | number> = { topic };
        folders.forEach((folderId) => {
          const label = folderNamesById[folderId as string] ?? "Unsorted";
          entry[label] = new Set(
            data.trends
              .filter((row) => row.folder_id === folderId && row.topic === topic)
              .map((row) => row.paper_id)
          ).size;
        });
        return entry;
      });

      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="topic" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {folders.map((folderId, index) => {
                  const label = folderNamesById[folderId as string] ?? "Unsorted";
                  return (
                    <Bar
                      key={label}
                      dataKey={label}
                      fill={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                      radius={[6, 6, 0, 0]}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartShell>
      );
    }

    if (chart.chart_key === "adaptive_keyword_family_heatmap") {
      const heatN = chart.config?.heat_n ?? 12;
      const topFamilies = (data.topicFamilies ?? [])
        .slice()
        .sort((left, right) => right.totalKeywordFrequency - left.totalKeywordFrequency)
        .slice(0, heatN);
      if (topFamilies.length === 0) {
        return null;
      }

      const rows = topFamilies.map((family) => family.canonicalTopic);
      const values = rows.map((topic) =>
        years.map((year) =>
          data.trends
            .filter((row) => row.year === year && row.topic === topic)
            .reduce((sum, row) => sum + row.keyword_frequency, 0)
        )
      );

      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <Heatmap
            rows={rows}
            cols={years}
            values={values}
            colorScale={["#fff7ed", "#c2410c"]}
          />
        </ChartShell>
      );
    }

    if (chart.chart_key === "adaptive_track_topic_comparison") {
      const topicLimit = chart.config?.top_n ?? 6;
      const selectedTracks =
        chart.config?.selected_tracks && chart.config.selected_tracks.length > 0
          ? chart.config.selected_tracks
          : (["EL", "ELI", "LAE", "Other"] as TrackKey[]);
      const topTopics = Object.entries(
        data.trends.reduce<Record<string, Set<PaperId>>>((accumulator, row) => {
          (accumulator[row.topic] ??= new Set()).add(row.paper_id);
          return accumulator;
        }, {})
      )
        .sort((left, right) => right[1].size - left[1].size)
        .slice(0, topicLimit)
        .map(([topic]) => topic);
      if (topTopics.length === 0) {
        return null;
      }

      const chartData = topTopics.map((topic) => {
        const entry: Record<string, string | number> = { topic };
        selectedTracks.forEach((track) => {
          entry[track] = new Set(
            data.trends
              .filter((row) => row.topic === topic)
              .filter((row) => Number(singleTrackByPaper.get(row.paper_id)?.[toTrackField(track)] ?? 0) === 1)
              .map((row) => row.paper_id)
          ).size;
        });
        return entry;
      });

      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="topic" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {selectedTracks.map((track) => (
                  <Bar
                    key={track}
                    dataKey={track}
                    fill={TRACK_COLORS[track]}
                    name={`${track} - ${TRACK_NAMES[track]}`}
                    radius={[6, 6, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartShell>
      );
    }

    return null;
  }

  const renderedCharts = adaptiveSection.charts
    .map((chart) => renderChart(chart))
    .filter((chart): chart is ReactNode => Boolean(chart));

  return (
    <div className="space-y-5">
      <section className="app-surface px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
          Adaptive section
        </p>
        <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
          {adaptiveSection.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
          {adaptiveSection.reason}
        </p>
      </section>

      {renderedCharts.length > 0 ? (
        renderedCharts
      ) : (
        <section className="app-surface px-5 py-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Adaptive charts need more normalized topic coverage before they can say something useful for the current filter set.
          </p>
        </section>
      )}
    </div>
  );
}

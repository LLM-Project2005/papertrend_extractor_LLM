"use client";

import type { ReactNode } from "react";
import { isDatedYear } from "@/lib/dated-year";
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
import type { NormalizedAnalyticsPayload, VisualizationPlanSection } from "@/types/visualization";
import { useTheme } from "@/components/theme/ThemeProvider";
import { chartTheme, tickStyle } from "@/lib/chart-theme";

const STRICT_MIN_TOPIC_PAPER_SUPPORT = 2;
const STRICT_MIN_TOPIC_TRACK_SUPPORT = 2;
const STRICT_MIN_TOPIC_YEAR_SUPPORT = 2;

function truncateLabel(value: string, max = 34) {
  const text = value.trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
}

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
  analytics,
  adaptiveSection,
}: {
  data: Pick<DashboardData, "trends" | "tracksSingle" | "tracksMulti" | "topicFamilies">;
  analytics: NormalizedAnalyticsPayload;
  adaptiveSection: VisualizationPlanSection;
}) {
  const { theme, hydrated } = useTheme();
  const ct = chartTheme(hydrated && theme === "dark");
  // Dated years only. Every use of this list is a temporal axis - the
  // heatmap columns, the momentum series, and the early/late split that
  // decides what counts as emerging - and "Unknown" sorts after "2026",
  // so an undated paper was being plotted as the most recent period and
  // counted as recent growth. The planner had the same bug; fixing it
  // there did not reach this component, which does its own split.
  const years = [...new Set(data.trends.map((row) => row.year))]
    .filter(isDatedYear)
    .sort();
  const singleTrackByPaper = new Map(data.tracksSingle.map((row) => [row.paper_id, row]));
  const totalPapers = analytics.overview.paper_count;
  const totalTopics = analytics.overview.topic_count;
  const totalKeywords = analytics.overview.keyword_count;
  const totalYears = analytics.overview.available_years.length;
  const sparseDataMode = totalPapers < 12 || years.length < 3;
  const minTopicPaperSupport = sparseDataMode ? 1 : STRICT_MIN_TOPIC_PAPER_SUPPORT;
  const minTopicTrackSupport = sparseDataMode ? 1 : STRICT_MIN_TOPIC_TRACK_SUPPORT;
  const minTopicYearSupport = sparseDataMode ? 1 : STRICT_MIN_TOPIC_YEAR_SUPPORT;

  const topicPaperSupport = new Map<string, Set<PaperId>>();
  for (const row of data.trends) {
    const topic = String(row.topic || "").trim();
    if (!topic) {
      continue;
    }
    const bucket = topicPaperSupport.get(topic) ?? new Set<PaperId>();
    bucket.add(row.paper_id);
    topicPaperSupport.set(topic, bucket);
  }

  const eligibleTopics = new Set(
    [...topicPaperSupport.entries()]
      .filter(([, papers]) => papers.size >= minTopicPaperSupport)
      .map(([topic]) => topic)
  );

  function renderChart(
    chart: VisualizationPlanSection["charts"][number]
  ): ReactNode | null {
    if (chart.chart_key === "adaptive_year_volume") {
      const chartData = analytics.yearly_paper_trend.filter((row) => row.papers > 0);
      if (chartData.length < 2) return null;
      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} stroke={ct.grid} strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <Tooltip />
                <Bar dataKey="papers" name="Papers" fill={ct.barFill} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {analytics.overview.papers_without_year > 0 ? (
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-[#999]">
              {analytics.overview.papers_without_year} paper
              {analytics.overview.papers_without_year === 1 ? " is" : "s are"} not shown here because
              no publication year could be read from{" "}
              {analytics.overview.papers_without_year === 1 ? "it" : "them"}. A missing year is not a
              period, so counting it would distort the trend.
            </p>
          ) : null}
        </ChartShell>
      );
    }

    if (chart.chart_key === "adaptive_topic_distribution") {
      const chartData = analytics.canonical_topic_families
        .map((row) => ({ topic: row.canonical_topic, papers: row.paper_count }))
        .filter((row) => row.papers > 0)
        .sort((left, right) => right.papers - left.papers)
        .slice(0, chart.config?.top_n ?? 8);
      if (chartData.length < 2) return null;
      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 18, right: 20 }}>
                <CartesianGrid horizontal={false} stroke={ct.grid} strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <YAxis type="category" dataKey="topic" width={210} tick={tickStyle(ct, 11)} tickFormatter={(value) => truncateLabel(String(value), 30)} stroke={ct.axisLine} />
                <Tooltip />
                <Bar dataKey="papers" name="Papers" fill={ct.barFill} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartShell>
      );
    }

    if (chart.chart_key === "adaptive_track_distribution") {
      const chartData = analytics.track_totals.single
        .map((row) => ({
          track: row.track,
          label: `${row.track} - ${TRACK_NAMES[row.track]}`,
          papers: row.value,
        }))
        .filter((row) => row.papers > 0);
      if (chartData.length < 2) return null;
      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} stroke={ct.grid} strokeDasharray="3 3" />
                <XAxis dataKey="track" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <Tooltip />
                <Bar dataKey="papers" name="Papers" fill={ct.barFill} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartShell>
      );
    }

    if (chart.chart_key === "adaptive_topic_momentum") {
      const topicLimit = chart.config?.top_n ?? 6;
      const topTopics = Object.entries(
        data.trends.reduce<Record<string, Set<PaperId>>>((accumulator, row) => {
          if (!eligibleTopics.has(row.topic)) {
            return accumulator;
          }
          (accumulator[row.topic] ??= new Set()).add(row.paper_id);
          return accumulator;
        }, {})
      )
        .sort((left, right) => right[1].size - left[1].size)
        .filter(([topic, papers]) => {
          if (papers.size < 2) return false;
          const values = years.map(
            (year) =>
              new Set(
                data.trends
                  .filter((row) => row.year === year && row.topic === topic)
                  .map((row) => row.paper_id)
              ).size
          );
          return values.filter((value) => value > 0).length >= 2 && new Set(values).size >= 2;
        })
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

      const nonFlatChartData = chartData.filter((entry) =>
        topTopics.some((topic) => Number(entry[topic] ?? 0) > 0)
      );
      if (nonFlatChartData.length < minTopicYearSupport) {
        return null;
      }

      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={nonFlatChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
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
      if (years.length < 3 && !sparseDataMode) {
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
          support: value.late.size + value.early.size,
        }))
        .filter((row) => row.change !== 0 && row.support >= minTopicPaperSupport)
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
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis type="number" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <YAxis
                  type="category"
                  dataKey="topic"
                  width={190}
                  tick={tickStyle(ct, 11)}
                  stroke={ct.axisLine}
                />
                <Tooltip />
                <Bar
                  dataKey="change"
                  fill={ct.barFill}
                  radius={[0, 8, 8, 0]}
                />
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
      const supportedTracks = selectedTracks.filter((track) =>
        data.tracksSingle.some((row) => Number(row[toTrackField(track)] ?? 0) === 1)
      );
      if (supportedTracks.length < 2) return null;
      const topTopics = Object.entries(
        data.trends.reduce<Record<string, Set<PaperId>>>((accumulator, row) => {
          if (!eligibleTopics.has(row.topic)) {
            return accumulator;
          }
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
        let totalSupport = 0;
        let nonZeroTracks = 0;
        supportedTracks.forEach((track) => {
          const value = new Set(
            data.trends
              .filter((row) => row.topic === topic)
              .filter((row) => Number(singleTrackByPaper.get(row.paper_id)?.[toTrackField(track)] ?? 0) === 1)
              .map((row) => row.paper_id)
          ).size;
          totalSupport += value;
          if (value > 0) nonZeroTracks += 1;
          entry[track] = value;
        });
        return totalSupport >= minTopicTrackSupport && nonZeroTracks >= 2 ? entry : null;
      });

      const filteredChartData = chartData.filter(
        (entry): entry is Record<string, string | number> => Boolean(entry)
      );
      // One topic is not a comparison. The live chart drew a single bar group
      // with a legend of four tracks, two of which had no bar at all - it read
      // as a broken chart rather than as a finding.
      if (filteredChartData.length < 2) {
        return null;
      }
      // Only tracks that actually draw something belong in the legend.
      const drawnTracks = supportedTracks.filter((track) =>
        filteredChartData.some((entry) => Number(entry[track] ?? 0) > 0)
      );
      if (drawnTracks.length < 2) {
        return null;
      }

      return (
        <ChartShell key={chart.chart_key} title={chart.title} reason={chart.reason}>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filteredChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis
                  dataKey="topic"
                  tick={tickStyle(ct, 11)}
                  tickFormatter={(value) => truncateLabel(String(value))}
                  stroke={ct.axisLine}
                />
                <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {drawnTracks.map((track) => (
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

  // A chart the agent planned can still be dropped here, because only this
  // layer knows whether the data supports drawing it. The narrative above was
  // written before that happened, so it promised "track comparisons" while the
  // comparison chart was being suppressed for having a single topic. Saying
  // which charts were dropped keeps the section honest without rewriting the
  // agent's own words.
  const planned = adaptiveSection.charts.map((chart) => ({
    chart,
    node: renderChart(chart),
  }));
  const renderedCharts = planned
    .map((entry) => entry.node)
    .filter((chart): chart is ReactNode => Boolean(chart));
  const droppedCharts = planned.filter((entry) => !entry.node).map((entry) => entry.chart.title);

  return (
    <div className="space-y-5">
      <section className="app-surface px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
          Adaptive section
        </p>
        <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
          {adaptiveSection.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
          {adaptiveSection.reason}
        </p>
        {droppedCharts.length > 0 ? (
          <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-[#999]">
            {droppedCharts.length === 1 ? "One chart was" : `${droppedCharts.length} charts were`}{" "}
            planned and not drawn, because this data does not support{" "}
            {droppedCharts.length === 1 ? "it" : "them"}:{" "}
            {droppedCharts.join("; ")}.
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Papers", value: totalPapers, tone: "text-slate-900 dark:text-white" },
          { label: "Canonical topics", value: totalTopics, tone: "text-slate-900 dark:text-white" },
          { label: "Grounded keywords", value: totalKeywords, tone: "text-slate-900 dark:text-white" },
          { label: "Years represented", value: totalYears, tone: "text-slate-900 dark:text-white" },
        ].map((card) => (
          <section key={card.label} className="app-surface px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
              {card.label}
            </p>
            <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
          </section>
        ))}
      </section>

      {renderedCharts.length > 0 ? renderedCharts : null}

      {renderedCharts.length === 0 ? (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">No reliable chart for this snapshot</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            The selected plan did not have enough varied values to render honestly. Broaden the filters, then use Update charts.
          </p>
        </section>
      ) : null}
    </div>
  );
}

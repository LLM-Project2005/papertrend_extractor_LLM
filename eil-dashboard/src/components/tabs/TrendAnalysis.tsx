"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
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
import { TOPIC_PALETTE } from "@/lib/constants";
import type { TrendRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
}

export default function TrendAnalysis({ trends }: Props) {
  const [topN, setTopN] = useState(10);
  const [heatN, setHeatN] = useState(15);

  const topTopics = useMemo(() => {
    const counts: Record<string, Set<number>> = {};
    trends.forEach((row) => {
      (counts[row.topic] ??= new Set()).add(row.paper_id);
    });
    return Object.entries(counts)
      .sort((left, right) => right[1].size - left[1].size)
      .slice(0, topN)
      .map(([topic]) => topic);
  }, [topN, trends]);

  const areaData = useMemo(() => {
    const years = [...new Set(trends.map((row) => row.year))].sort();
    return years.map((year) => {
      const entry: Record<string, string | number> = { year };
      topTopics.forEach((topic) => {
        const ids = new Set(
          trends
            .filter((row) => row.year === year && row.topic === topic)
            .map((row) => row.paper_id)
        );
        entry[topic] = ids.size;
      });
      return entry;
    });
  }, [topTopics, trends]);

  const { emerging, declining } = useMemo(() => {
    const years = [...new Set(trends.map((row) => row.year))].sort();
    if (years.length < 2) {
      return { emerging: [], declining: [] };
    }

    const midpoint = Math.floor(years.length / 2);
    const early = new Set(years.slice(0, midpoint));
    const late = new Set(years.slice(midpoint));

    const countIn = (yearSet: Set<string>) => {
      const counts: Record<string, Set<number>> = {};
      trends
        .filter((row) => yearSet.has(row.year))
        .forEach((row) => (counts[row.topic] ??= new Set()).add(row.paper_id));
      return counts;
    };

    const earlyCounts = countIn(early);
    const lateCounts = countIn(late);
    const topics = new Set([...Object.keys(earlyCounts), ...Object.keys(lateCounts)]);

    const shifts = [...topics]
      .map((topic) => ({
        topic,
        change: (lateCounts[topic]?.size ?? 0) - (earlyCounts[topic]?.size ?? 0),
      }))
      .sort((left, right) => right.change - left.change);

    return {
      emerging: shifts.filter((shift) => shift.change > 0).slice(0, 8),
      declining: shifts.filter((shift) => shift.change < 0).slice(-8).reverse(),
    };
  }, [trends]);

  const heatmapData = useMemo(() => {
    const years = [...new Set(trends.map((row) => row.year))].sort();
    const keywordTotals: Record<string, number> = {};

    trends.forEach((row) => {
      keywordTotals[row.keyword] =
        (keywordTotals[row.keyword] ?? 0) + row.keyword_frequency;
    });

    const topKeywords = Object.entries(keywordTotals)
      .sort((left, right) => right[1] - left[1])
      .slice(0, heatN)
      .map(([keyword]) => keyword);

    const grid: Record<string, Record<string, number>> = {};
    trends.forEach((row) => {
      if (!topKeywords.includes(row.keyword)) {
        return;
      }
      grid[row.keyword] ??= {};
      grid[row.keyword][row.year] =
        (grid[row.keyword][row.year] ?? 0) + row.keyword_frequency;
    });

    return {
      rows: topKeywords,
      cols: years,
      values: topKeywords.map((keyword) =>
        years.map((year) => grid[keyword]?.[year] ?? 0)
      ),
    };
  }, [heatN, trends]);

  if (trends.length === 0) {
    return (
      <div className="app-surface px-5 py-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No data for the selected filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Trend analysis
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Follow topic movement and keyword intensity across the selected year range.
        </p>
      </section>

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Topic trends over time
          </h3>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Top topics: {topN}
          </label>
          <input
            type="range"
            min={3}
            max={25}
            value={topN}
            onChange={(event) => setTopN(+event.target.value)}
            className="w-40"
          />
        </div>

        <div className="mt-4 h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={areaData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {topTopics.map((topic, index) => (
                <Area
                  key={topic}
                  type="monotone"
                  dataKey={topic}
                  stackId="1"
                  stroke={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                  fill={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                  fillOpacity={0.55}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {(emerging.length > 0 || declining.length > 0) && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Emerging and declining topics
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Compares the first half and second half of the current selection.
          </p>

          <div className="mt-5 grid gap-6 xl:grid-cols-2">
            {emerging.length > 0 && (
              <div>
                <p className="mb-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Emerging
                </p>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={emerging} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis
                        type="category"
                        dataKey="topic"
                        width={180}
                        tick={{ fontSize: 11 }}
                        stroke="#94a3b8"
                      />
                      <Tooltip />
                      <Bar dataKey="change" fill="#10b981" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {declining.length > 0 && (
              <div>
                <p className="mb-3 text-sm font-medium text-rose-700 dark:text-rose-400">
                  Declining
                </p>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={declining} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis
                        type="category"
                        dataKey="topic"
                        width={180}
                        tick={{ fontSize: 11 }}
                        stroke="#94a3b8"
                      />
                      <Tooltip />
                      <Bar dataKey="change" fill="#f43f5e" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Keyword frequency heatmap
          </h3>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Top keywords: {heatN}
          </label>
          <input
            type="range"
            min={5}
            max={40}
            value={heatN}
            onChange={(event) => setHeatN(+event.target.value)}
            className="w-40"
          />
        </div>

        <div className="mt-4">
          <Heatmap
            rows={heatmapData.rows}
            cols={heatmapData.cols}
            values={heatmapData.values}
            colorScale={["#fff7ec", "#cc4c02"]}
          />
        </div>
      </section>
    </div>
  );
}

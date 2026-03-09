"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
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

  // ── Top-N topics ────────────────────────────────────────
  const topTopics = useMemo(() => {
    const counts: Record<string, Set<number>> = {};
    trends.forEach((r) => {
      (counts[r.topic] ??= new Set()).add(r.paper_id);
    });
    return Object.entries(counts)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, topN)
      .map(([t]) => t);
  }, [trends, topN]);

  // ── Area chart data ─────────────────────────────────────
  const areaData = useMemo(() => {
    const years = [...new Set(trends.map((r) => r.year))].sort();
    return years.map((year) => {
      const row: Record<string, string | number> = { year };
      topTopics.forEach((topic) => {
        const ids = new Set(
          trends
            .filter((r) => r.year === year && r.topic === topic)
            .map((r) => r.paper_id)
        );
        row[topic] = ids.size;
      });
      return row;
    });
  }, [trends, topTopics]);

  // ── Emerging / declining ────────────────────────────────
  const { emerging, declining } = useMemo(() => {
    const years = [...new Set(trends.map((r) => r.year))].sort();
    if (years.length < 2) return { emerging: [], declining: [] };
    const mid = Math.floor(years.length / 2);
    const early = new Set(years.slice(0, mid));
    const late = new Set(years.slice(mid));

    const countIn = (yearSet: Set<string>) => {
      const c: Record<string, Set<number>> = {};
      trends
        .filter((r) => yearSet.has(r.year))
        .forEach((r) => (c[r.topic] ??= new Set()).add(r.paper_id));
      return c;
    };
    const earlyC = countIn(early);
    const lateC = countIn(late);
    const allTopics = new Set([
      ...Object.keys(earlyC),
      ...Object.keys(lateC),
    ]);

    const shifts = [...allTopics].map((t) => ({
      topic: t,
      change: (lateC[t]?.size ?? 0) - (earlyC[t]?.size ?? 0),
    }));
    shifts.sort((a, b) => b.change - a.change);

    return {
      emerging: shifts.filter((s) => s.change > 0).slice(0, 8),
      declining: shifts.filter((s) => s.change < 0).slice(-8).reverse(),
    };
  }, [trends]);

  // ── Keyword heatmap ─────────────────────────────────────
  const heatmapData = useMemo(() => {
    const years = [...new Set(trends.map((r) => r.year))].sort();
    // aggregate keyword_frequency
    const kwTotals: Record<string, number> = {};
    trends.forEach((r) => {
      kwTotals[r.keyword] = (kwTotals[r.keyword] ?? 0) + r.keyword_frequency;
    });
    const topKws = Object.entries(kwTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, heatN)
      .map(([kw]) => kw);

    // build grid[kw][year]
    const grid: Record<string, Record<string, number>> = {};
    trends.forEach((r) => {
      if (!topKws.includes(r.keyword)) return;
      grid[r.keyword] ??= {};
      grid[r.keyword][r.year] =
        (grid[r.keyword][r.year] ?? 0) + r.keyword_frequency;
    });

    const values = topKws.map((kw) =>
      years.map((y) => grid[kw]?.[y] ?? 0)
    );

    return { rows: topKws, cols: years, values };
  }, [trends, heatN]);

  if (trends.length === 0) {
    return <p className="text-gray-400">No data for the selected filters.</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Research Trend Analysis</h2>

      {/* ── Topic area chart ───────────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Topic Trends Over Time
        </h3>
        <label className="text-xs text-gray-500 mr-2">Show top N topics:</label>
        <input
          type="range"
          min={3}
          max={25}
          value={topN}
          onChange={(e) => setTopN(+e.target.value)}
          className="align-middle w-40"
        />
        <span className="text-xs ml-1 text-gray-600">{topN}</span>

        <ResponsiveContainer width="100%" height={360} className="mt-3">
          <AreaChart data={areaData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              verticalAlign="bottom"
              height={60}
            />
            {topTopics.map((topic, i) => (
              <Area
                key={topic}
                type="monotone"
                dataKey={topic}
                stackId="1"
                stroke={TOPIC_PALETTE[i % TOPIC_PALETTE.length]}
                fill={TOPIC_PALETTE[i % TOPIC_PALETTE.length]}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Emerging / Declining ───────────────────────────── */}
      {(emerging.length > 0 || declining.length > 0) && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">
            Emerging and Declining Topics
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            Compares the first half vs second half of the selected year range.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {emerging.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-green-700 mb-2">
                  Emerging
                </h4>
                <ResponsiveContainer width="100%" height={emerging.length * 36 + 30}>
                  <BarChart
                    data={emerging}
                    layout="vertical"
                    margin={{ left: 10, right: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="topic"
                      width={180}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Bar dataKey="change" fill="#3cba83" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {declining.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-red-600 mb-2">
                  Declining
                </h4>
                <ResponsiveContainer width="100%" height={declining.length * 36 + 30}>
                  <BarChart
                    data={declining}
                    layout="vertical"
                    margin={{ left: 10, right: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="topic"
                      width={180}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Bar dataKey="change" fill="#e05c5c" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Keyword heatmap ────────────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Keyword Frequency Heatmap
        </h3>
        <label className="text-xs text-gray-500 mr-2">Show top N keywords:</label>
        <input
          type="range"
          min={5}
          max={40}
          value={heatN}
          onChange={(e) => setHeatN(+e.target.value)}
          className="align-middle w-40"
        />
        <span className="text-xs ml-1 text-gray-600">{heatN}</span>

        <div className="mt-3">
          <Heatmap
            rows={heatmapData.rows}
            cols={heatmapData.cols}
            values={heatmapData.values}
            colorScale={["#fff7ec", "#cc4c02"]}
          />
        </div>
      </div>
    </div>
  );
}

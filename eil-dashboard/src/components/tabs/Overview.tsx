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
  Legend,
} from "recharts";
import MetricCard from "@/components/MetricCard";
import { TRACK_COLS, TRACK_COLORS, type TrackKey } from "@/lib/constants";
import type { TrendRow, TrackRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  selectedTracks: string[];
  useMock: boolean;
}

export default function Overview({
  trends,
  tracksSingle,
  tracksMulti,
  selectedTracks,
  useMock,
}: Props) {
  // ── Metrics ──────────────────────────────────────────────
  const nPapers = new Set(trends.map((r) => r.paper_id)).size;
  const nTopics = new Set(trends.map((r) => r.topic)).size;
  const nKeywords = new Set(trends.map((r) => r.keyword)).size;
  const years = [...new Set(trends.map((r) => r.year))].sort();
  const yearSpan =
    years.length > 0 ? `${years[0]} – ${years[years.length - 1]}` : "—";

  // ── Papers per year ──────────────────────────────────────
  const papersByYear = Object.entries(
    trends.reduce<Record<string, Set<number>>>((acc, r) => {
      (acc[r.year] ??= new Set()).add(r.paper_id);
      return acc;
    }, {})
  )
    .map(([year, ids]) => ({ year, papers: ids.size }))
    .sort((a, b) => a.year.localeCompare(b.year));

  // ── Track donut helper ───────────────────────────────────
  const buildDonut = (rows: TrackRow[]) =>
    TRACK_COLS.filter((t) => selectedTracks.includes(t)).map((t) => ({
      name: t,
      value: rows.reduce(
        (s, r) => s + (r[t.toLowerCase() as keyof TrackRow] as number),
        0
      ),
    }));

  const donutSingle = buildDonut(tracksSingle);
  const donutMulti = buildDonut(tracksMulti);

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Research Overview</h2>
      {useMock && (
        <p className="text-xs text-gray-400 mb-4">
          Preview with mock data — actual results will replace this after
          connecting Supabase.
        </p>
      )}

      {/* ── Metric cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Papers" value={nPapers} />
        <MetricCard label="Unique Topics" value={nTopics} />
        <MetricCard label="Unique Keywords" value={nKeywords} />
        <MetricCard label="Year Span" value={yearSpan} />
      </div>

      {/* ── Papers per year bar chart ──────────────────────── */}
      {papersByYear.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Papers Published per Year
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={papersByYear}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar
                dataKey="papers"
                fill="#4a7fe5"
                radius={[4, 4, 0, 0]}
                label={{ position: "top", fontSize: 11 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Track donuts ───────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-8">
        {donutSingle.some((d) => d.value > 0) && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Track Distribution (Single-Choice)
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={donutSingle}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={2}
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                >
                  {donutSingle.map((d) => (
                    <Cell
                      key={d.name}
                      fill={TRACK_COLORS[d.name as TrackKey]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {donutMulti.some((d) => d.value > 0) && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Track Distribution (Multi-Label)
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={donutMulti}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={2}
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                >
                  {donutMulti.map((d) => (
                    <Cell
                      key={d.name}
                      fill={TRACK_COLORS[d.name as TrackKey]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

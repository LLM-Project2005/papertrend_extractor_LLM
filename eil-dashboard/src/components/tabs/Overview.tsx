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
  const nPapers = new Set(trends.map((row) => row.paper_id)).size;
  const nTopics = new Set(trends.map((row) => row.topic)).size;
  const nKeywords = new Set(trends.map((row) => row.keyword)).size;
  const years = [...new Set(trends.map((row) => row.year))].sort();
  const yearSpan =
    years.length > 0 ? `${years[0]} to ${years[years.length - 1]}` : "No data";

  const papersByYear = Object.entries(
    trends.reduce<Record<string, Set<number>>>((accumulator, row) => {
      (accumulator[row.year] ??= new Set()).add(row.paper_id);
      return accumulator;
    }, {})
  )
    .map(([year, ids]) => ({ year, papers: ids.size }))
    .sort((left, right) => left.year.localeCompare(right.year));

  const buildDonut = (rows: TrackRow[]) =>
    TRACK_COLS.filter((track) => selectedTracks.includes(track)).map((track) => ({
      name: track,
      value: rows.reduce(
        (sum, row) => sum + (row[track.toLowerCase() as keyof TrackRow] as number),
        0
      ),
    }));

  const donutSingle = buildDonut(tracksSingle);
  const donutMulti = buildDonut(tracksMulti);

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Overview
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          A quick read on corpus coverage, publication volume, and track balance.
        </p>
        {useMock && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            Preview data is active. Real results will replace this after Supabase is populated.
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total papers" value={nPapers} />
        <MetricCard label="Unique topics" value={nTopics} />
        <MetricCard label="Unique keywords" value={nKeywords} />
        <MetricCard label="Coverage" value={yearSpan} />
      </div>

      {papersByYear.length > 0 && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Papers published per year
          </h3>
          <div className="mt-4 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={papersByYear}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="papers" fill="#0f172a" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {donutSingle.some((item) => item.value > 0) && (
          <section className="app-surface px-5 py-5">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Track distribution
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Single-label assignments
            </p>
            <div className="mt-4 h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutSingle}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={95}
                    paddingAngle={2}
                  >
                    {donutSingle.map((item) => (
                      <Cell key={item.name} fill={TRACK_COLORS[item.name as TrackKey]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {donutMulti.some((item) => item.value > 0) && (
          <section className="app-surface px-5 py-5">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Track overlap
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Multi-label assignments
            </p>
            <div className="mt-4 h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutMulti}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={95}
                    paddingAngle={2}
                  >
                    {donutMulti.map((item) => (
                      <Cell key={item.name} fill={TRACK_COLORS[item.name as TrackKey]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

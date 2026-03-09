"use client";

import { useMemo } from "react";
import {
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
import {
  TRACK_COLS,
  TRACK_COLORS,
  TRACK_NAMES,
  type TrackKey,
} from "@/lib/constants";
import type { TrendRow, TrackRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  selectedTracks: string[];
}

const trackField = (t: string) => t.toLowerCase() as "el" | "eli" | "lae" | "other";

export default function TrackAnalysis({
  trends,
  tracksSingle,
  tracksMulti,
  selectedTracks,
}: Props) {
  // ── Stacked bar: papers per track per year ──────────────
  const stackedData = useMemo(() => {
    const years = [...new Set(tracksSingle.map((r) => r.year))].sort();
    return years.map((year) => {
      const row: Record<string, string | number> = { year };
      const yearRows = tracksSingle.filter((r) => r.year === year);
      TRACK_COLS.filter((t) => selectedTracks.includes(t)).forEach((t) => {
        row[t] = yearRows.reduce((s, r) => s + r[trackField(t)], 0);
      });
      return row;
    });
  }, [tracksSingle, selectedTracks]);

  // ── Co-occurrence matrix ────────────────────────────────
  const coMatrix = useMemo(() => {
    const matrix = TRACK_COLS.map((t1) =>
      TRACK_COLS.map((t2) =>
        tracksMulti.reduce(
          (s, r) =>
            s + (r[trackField(t1)] === 1 && r[trackField(t2)] === 1 ? 1 : 0),
          0
        )
      )
    );
    return matrix;
  }, [tracksMulti]);

  // ── Top topics per track ────────────────────────────────
  const topicsPerTrack = useMemo(() => {
    // merge trends with single-choice track
    const trackMap = new Map(tracksSingle.map((r) => [r.paper_id, r]));
    const result: Record<string, { topic: string; papers: number }[]> = {};

    TRACK_COLS.filter((t) => selectedTracks.includes(t)).forEach((track) => {
      const counts: Record<string, Set<number>> = {};
      trends.forEach((r) => {
        const tr = trackMap.get(r.paper_id);
        if (tr && tr[trackField(track)] === 1) {
          (counts[r.topic] ??= new Set()).add(r.paper_id);
        }
      });
      result[track] = Object.entries(counts)
        .map(([topic, ids]) => ({ topic, papers: ids.size }))
        .sort((a, b) => b.papers - a.papers)
        .slice(0, 8);
    });

    return result;
  }, [trends, tracksSingle, selectedTracks]);

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">EIL Track Analysis</h2>

      {/* ── Stacked bar ────────────────────────────────────── */}
      {stackedData.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Papers per Track per Year (Single-Choice)
          </h3>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={stackedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {TRACK_COLS.filter((t) => selectedTracks.includes(t)).map((t) => (
                <Bar
                  key={t}
                  dataKey={t}
                  stackId="a"
                  fill={TRACK_COLORS[t as TrackKey]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Co-occurrence heatmap ──────────────────────────── */}
      {tracksMulti.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">
            Track Co-occurrence (Multi-Label Overlap)
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            How often two tracks appear together on the same paper.
          </p>
          <Heatmap
            rows={[...TRACK_COLS]}
            cols={[...TRACK_COLS]}
            values={coMatrix}
            colorScale={["#eff6ff", "#1e40af"]}
          />
        </div>
      )}

      {/* ── Top topics per track ───────────────────────────── */}
      {Object.keys(topicsPerTrack).length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Top Topics per Track
          </h3>
          <div
            className="grid gap-6"
            style={{
              gridTemplateColumns: `repeat(${
                Object.keys(topicsPerTrack).length
              }, 1fr)`,
            }}
          >
            {Object.entries(topicsPerTrack).map(([track, data]) => (
              <div key={track}>
                <p className="text-xs font-semibold mb-2">
                  <span style={{ color: TRACK_COLORS[track as TrackKey] }}>
                    {track}
                  </span>{" "}
                  — {TRACK_NAMES[track as TrackKey]}
                </p>
                {data.length > 0 ? (
                  <ResponsiveContainer width="100%" height={data.length * 32 + 20}>
                    <BarChart
                      data={data}
                      layout="vertical"
                      margin={{ left: 0, right: 8 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 10 }} hide />
                      <YAxis
                        type="category"
                        dataKey="topic"
                        width={150}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip />
                      <Bar
                        dataKey="papers"
                        fill={TRACK_COLORS[track as TrackKey]}
                        radius={[0, 4, 4, 0]}
                        barSize={16}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-gray-400">No data</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

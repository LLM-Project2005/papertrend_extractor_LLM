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
import type { TrendRow, TrackRow } from "@/types/database";
import type { VisualizationPlanChart } from "@/types/visualization";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
  tracksMulti: TrackRow[];
  selectedTracks: string[];
  planCharts?: VisualizationPlanChart[];
}

const trackField = (track: string) =>
  track.toLowerCase() as "el" | "eli" | "lae" | "other";

export default function TrackAnalysis({
  trends,
  tracksSingle,
  tracksMulti,
  selectedTracks,
  planCharts,
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

  const stackedData = useMemo(() => {
    const years = [...new Set(tracksSingle.map((row) => row.year))].sort();
    return years.map((year) => {
      const entry: Record<string, string | number> = { year };
      const yearRows = tracksSingle.filter((row) => row.year === year);
      TRACK_COLS.filter((track) => stackedTracks.includes(track)).forEach((track) => {
        entry[track] = yearRows.reduce((sum, row) => sum + row[trackField(track)], 0);
      });
      return entry;
    });
  }, [stackedTracks, tracksSingle]);

  const coMatrix = useMemo(
    () =>
      TRACK_COLS.filter((track) => topicTracks.includes(track)).map((leftTrack) =>
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
      ),
    [topicTracks, tracksMulti]
  );

  const topicsPerTrack = useMemo(() => {
    const trackMap = new Map(tracksSingle.map((row) => [row.paper_id, row]));
    const result: Record<string, { topic: string; papers: number }[]> = {};

    TRACK_COLS.filter((track) => topicTracks.includes(track)).forEach((track) => {
      const counts: Record<string, Set<number>> = {};
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
  }, [topicTracks, topicsPerTrackLimit, tracksSingle, trends]);

  return (
    <div className="space-y-6">
      <section className="app-surface px-5 py-5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Track analysis
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Review category balance, overlap, and the topic clusters most tied to each track.
        </p>
      </section>

      {orderedCharts.includes("track_year_stacked") && stackedData.length > 0 && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Papers per track per year
          </h3>
          <div className="mt-4 h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {TRACK_COLS.filter((track) => stackedTracks.includes(track)).map((track) => (
                  <Bar
                    key={track}
                    dataKey={track}
                    stackId="tracks"
                    fill={TRACK_COLORS[track as TrackKey]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {orderedCharts.includes("track_cooccurrence") && tracksMulti.length > 0 && (
        <section className="app-surface px-5 py-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Track co-occurrence
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            How often tracks appear together on the same paper.
          </p>
          <div className="mt-4">
            <Heatmap
              rows={TRACK_COLS.filter((track) => topicTracks.includes(track))}
              cols={TRACK_COLS.filter((track) => topicTracks.includes(track))}
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
            Top topics per track
          </h3>
          <div
            className="mt-5 grid gap-6"
            style={{
              gridTemplateColumns: `repeat(${Object.keys(topicsPerTrack).length}, minmax(0, 1fr))`,
            }}
          >
            {Object.entries(topicsPerTrack).map(([track, data]) => (
              <div key={track}>
                <p className="mb-3 text-sm font-medium text-slate-900 dark:text-white">
                  <span style={{ color: TRACK_COLORS[track as TrackKey] }}>{track}</span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {TRACK_NAMES[track as TrackKey]}
                  </span>
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
                          fill={TRACK_COLORS[track as TrackKey]}
                          radius={[0, 6, 6, 0]}
                          barSize={16}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No data</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

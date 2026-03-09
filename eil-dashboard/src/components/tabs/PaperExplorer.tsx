"use client";

import { useState, useMemo } from "react";
import { TRACK_COLS } from "@/lib/constants";
import type { TrendRow, TrackRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
  tracksSingle: TrackRow[];
}

const trackField = (t: string) =>
  t.toLowerCase() as "el" | "eli" | "lae" | "other";

export default function PaperExplorer({ trends, tracksSingle }: Props) {
  const [search, setSearch] = useState("");
  const [selectedPaperId, setSelectedPaperId] = useState<number | null>(null);

  // ── Build paper list ────────────────────────────────────
  const papers = useMemo(() => {
    const map: Record<
      number,
      {
        paper_id: number;
        year: string;
        title: string;
        topics: Set<string>;
        keywords: Set<string>;
      }
    > = {};
    trends.forEach((r) => {
      const m = (map[r.paper_id] ??= {
        paper_id: r.paper_id,
        year: r.year,
        title: r.title,
        topics: new Set(),
        keywords: new Set(),
      });
      m.topics.add(r.topic);
      m.keywords.add(r.keyword);
    });

    const trackMap = new Map(tracksSingle.map((r) => [r.paper_id, r]));

    let list = Object.values(map)
      .map((p) => {
        const tr = trackMap.get(p.paper_id);
        const tracks = tr
          ? TRACK_COLS.filter((t) => tr[trackField(t)] === 1).join(", ") || "—"
          : "—";
        return {
          paper_id: p.paper_id,
          year: p.year,
          title: p.title,
          topics: [...p.topics].join(", "),
          keywords: [...p.keywords].join(", "),
          kwCount: p.keywords.size,
          track: tracks,
        };
      })
      .sort((a, b) => b.year.localeCompare(a.year));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q));
    }
    return list;
  }, [trends, tracksSingle, search]);

  // ── Detail rows ─────────────────────────────────────────
  const detail = useMemo(() => {
    if (selectedPaperId === null) return null;
    const rows = trends.filter((r) => r.paper_id === selectedPaperId);
    if (rows.length === 0) return null;

    const tr = tracksSingle.find((r) => r.paper_id === selectedPaperId);
    const tracks = tr
      ? TRACK_COLS.filter((t) => tr[trackField(t)] === 1).join(" / ")
      : null;

    return {
      title: rows[0].title,
      year: rows[0].year,
      tracks,
      keywords: rows.map((r) => ({
        keyword: r.keyword,
        frequency: r.keyword_frequency,
        topic: r.topic,
        evidence: r.evidence,
      })),
    };
  }, [trends, tracksSingle, selectedPaperId]);

  if (trends.length === 0)
    return <p className="text-gray-400">No data for the selected filters.</p>;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Paper Explorer</h2>

      {/* ── Search ─────────────────────────────────────────── */}
      <input
        type="text"
        placeholder="Search by title… e.g. peer feedback, EFL"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full md:w-96 border border-gray-300 rounded-lg px-3 py-2 text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />

      {/* ── Paper table ────────────────────────────────────── */}
      <div className="max-h-[480px] overflow-auto border border-gray-200 rounded-lg mb-8">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">ID</th>
              <th className="text-left px-3 py-2 font-semibold">Year</th>
              <th className="text-left px-3 py-2 font-semibold">Title</th>
              <th className="text-left px-3 py-2 font-semibold">Topics</th>
              <th className="text-left px-3 py-2 font-semibold">Keywords</th>
              <th className="text-right px-3 py-2 font-semibold"># KW</th>
              <th className="text-left px-3 py-2 font-semibold">Track</th>
            </tr>
          </thead>
          <tbody>
            {papers.map((p) => (
              <tr
                key={p.paper_id}
                className={`border-t cursor-pointer transition-colors ${
                  selectedPaperId === p.paper_id
                    ? "bg-blue-50"
                    : "hover:bg-gray-50"
                }`}
                onClick={() => setSelectedPaperId(p.paper_id)}
              >
                <td className="px-3 py-1.5 text-gray-500">{p.paper_id}</td>
                <td className="px-3 py-1.5">{p.year}</td>
                <td className="px-3 py-1.5 font-medium max-w-xs truncate">
                  {p.title}
                </td>
                <td className="px-3 py-1.5 text-gray-500 max-w-[160px] truncate">
                  {p.topics}
                </td>
                <td className="px-3 py-1.5 text-gray-500 max-w-[160px] truncate">
                  {p.keywords}
                </td>
                <td className="px-3 py-1.5 text-right">{p.kwCount}</td>
                <td className="px-3 py-1.5">{p.track}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Detail view ────────────────────────────────────── */}
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        Paper Detail View
      </h3>
      {detail ? (
        <div className="bg-card-bg border border-card-border rounded-xl p-5">
          <h4 className="text-base font-bold mb-1">{detail.title}</h4>
          <p className="text-xs text-gray-500 mb-1">
            <strong>Year:</strong> {detail.year}
          </p>
          {detail.tracks && (
            <p className="text-xs text-gray-500 mb-3">
              <strong>Track(s):</strong> {detail.tracks}
            </p>
          )}
          <div className="overflow-auto border border-gray-200 rounded-lg">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">
                    Keyword
                  </th>
                  <th className="text-right px-3 py-2 font-semibold">
                    Frequency
                  </th>
                  <th className="text-left px-3 py-2 font-semibold">Topic</th>
                  <th className="text-left px-3 py-2 font-semibold">
                    Evidence (Verbatim)
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.keywords.map((kw, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5 font-medium">{kw.keyword}</td>
                    <td className="px-3 py-1.5 text-right">{kw.frequency}</td>
                    <td className="px-3 py-1.5 text-gray-500">{kw.topic}</td>
                    <td className="px-3 py-1.5 text-gray-500 max-w-sm">
                      {kw.evidence}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">
          Click a row in the table above to see details.
        </p>
      )}
    </div>
  );
}

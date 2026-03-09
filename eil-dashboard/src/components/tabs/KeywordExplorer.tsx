"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Treemap,
} from "recharts";
import { TOPIC_PALETTE } from "@/lib/constants";
import type { TrendRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
}

/* Custom Treemap content renderer */
const TreemapCell = (props: {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  value: number;
  index: number;
}) => {
  const { x, y, width, height, name, value, index } = props;
  if (width < 4 || height < 4) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
        stroke="#fff"
        strokeWidth={2}
        rx={3}
      />
      {width > 50 && height > 28 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 6}
            textAnchor="middle"
            fill="#fff"
            fontSize={11}
            fontWeight={600}
          >
            {name.length > width / 7 ? name.slice(0, Math.floor(width / 7)) + "…" : name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="#ffffffcc"
            fontSize={10}
          >
            {value}
          </text>
        </>
      )}
    </g>
  );
};

export default function KeywordExplorer({ trends }: Props) {
  const [search, setSearch] = useState("");
  const [treeN, setTreeN] = useState(30);
  const [selectedKws, setSelectedKws] = useState<string[]>([]);

  // ── Aggregate keywords ──────────────────────────────────
  const kwAgg = useMemo(() => {
    const map: Record<
      string,
      { total: number; papers: Set<number>; years: Set<string>; topics: Set<string> }
    > = {};
    trends.forEach((r) => {
      const m = (map[r.keyword] ??= {
        total: 0,
        papers: new Set(),
        years: new Set(),
        topics: new Set(),
      });
      m.total += r.keyword_frequency;
      m.papers.add(r.paper_id);
      m.years.add(r.year);
      m.topics.add(r.topic);
    });

    let results = Object.entries(map)
      .map(([keyword, m]) => ({
        keyword,
        totalFreq: m.total,
        papers: m.papers.size,
        years: Array.from(m.years).sort().join(", "),
        topics: Array.from(m.topics).join(", "),
      }))
      .sort((a, b) => b.totalFreq - a.totalFreq);

    if (search) {
      const q = search.toLowerCase();
      results = results.filter((r) => r.keyword.toLowerCase().includes(q));
    }
    return results;
  }, [trends, search]);

  // ── Treemap data ────────────────────────────────────────
  const treeData = useMemo(
    () =>
      kwAgg.slice(0, treeN).map((r) => ({
        name: r.keyword,
        value: r.totalFreq,
      })),
    [kwAgg, treeN]
  );

  // ── Timeline data ───────────────────────────────────────
  const kws =
    selectedKws.length > 0
      ? selectedKws
      : kwAgg.slice(0, 5).map((r) => r.keyword);

  const timelineData = useMemo(() => {
    const years = [...new Set(trends.map((r) => r.year))].sort();
    return years.map((year) => {
      const row: Record<string, string | number> = { year };
      kws.forEach((kw) => {
        row[kw] = trends
          .filter((r) => r.year === year && r.keyword === kw)
          .reduce((s, r) => s + r.keyword_frequency, 0);
      });
      return row;
    });
  }, [trends, kws]);

  if (trends.length === 0)
    return <p className="text-gray-400">No data for the selected filters.</p>;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Keyword Explorer</h2>

      {/* ── Search ─────────────────────────────────────────── */}
      <input
        type="text"
        placeholder="Search keywords… e.g. translanguaging, assessment"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full md:w-96 border border-gray-300 rounded-lg px-3 py-2 text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />

      {/* ── Treemap ────────────────────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Keyword Treemap
        </h3>
        <label className="text-xs text-gray-500 mr-2">Show top N:</label>
        <input
          type="range"
          min={10}
          max={60}
          value={treeN}
          onChange={(e) => setTreeN(+e.target.value)}
          className="align-middle w-40"
        />
        <span className="text-xs ml-1 text-gray-600">{treeN}</span>

        {treeData.length > 0 && (
          <ResponsiveContainer width="100%" height={420} className="mt-2">
            <Treemap
              data={treeData}
              dataKey="value"
              nameKey="name"
              content={<TreemapCell x={0} y={0} width={0} height={0} name="" value={0} index={0} />}
            />
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Keyword Table
        </h3>
        <div className="max-h-[420px] overflow-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Keyword</th>
                <th className="text-right px-3 py-2 font-semibold">
                  Total Freq
                </th>
                <th className="text-right px-3 py-2 font-semibold">Papers</th>
                <th className="text-left px-3 py-2 font-semibold">
                  Years Active
                </th>
                <th className="text-left px-3 py-2 font-semibold">
                  Associated Topics
                </th>
              </tr>
            </thead>
            <tbody>
              {kwAgg.map((r) => (
                <tr key={r.keyword} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-medium">{r.keyword}</td>
                  <td className="px-3 py-1.5 text-right">{r.totalFreq}</td>
                  <td className="px-3 py-1.5 text-right">{r.papers}</td>
                  <td className="px-3 py-1.5 text-gray-500">{r.years}</td>
                  <td className="px-3 py-1.5 text-gray-500 max-w-xs truncate">
                    {r.topics}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Keyword timeline ───────────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Keyword Timeline
        </h3>
        <p className="text-xs text-gray-400 mb-2">
          Select keywords to compare (or the top 5 are shown by default).
        </p>
        <div className="flex flex-wrap gap-1 mb-3">
          {kwAgg.slice(0, 20).map((r) => (
            <button
              key={r.keyword}
              onClick={() =>
                setSelectedKws((prev) =>
                  prev.includes(r.keyword)
                    ? prev.filter((k) => k !== r.keyword)
                    : [...prev, r.keyword]
                )
              }
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                kws.includes(r.keyword)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}
            >
              {r.keyword}
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={timelineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {kws.map((kw, i) => (
              <Line
                key={kw}
                type="monotone"
                dataKey={kw}
                stroke={TOPIC_PALETTE[i % TOPIC_PALETTE.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

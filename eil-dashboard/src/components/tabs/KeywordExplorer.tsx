"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { TOPIC_PALETTE } from "@/lib/constants";
import type { TrendRow } from "@/types/database";

interface Props {
  trends: TrendRow[];
}

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
        rx={6}
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
            {name.length > width / 7 ? `${name.slice(0, Math.floor(width / 7))}...` : name}
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
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);

  const keywordAggregate = useMemo(() => {
    const map: Record<
      string,
      { total: number; papers: Set<number>; years: Set<string>; topics: Set<string> }
    > = {};

    trends.forEach((row) => {
      const entry = (map[row.keyword] ??= {
        total: 0,
        papers: new Set(),
        years: new Set(),
        topics: new Set(),
      });
      entry.total += row.keyword_frequency;
      entry.papers.add(row.paper_id);
      entry.years.add(row.year);
      entry.topics.add(row.topic);
    });

    let results = Object.entries(map)
      .map(([keyword, entry]) => ({
        keyword,
        totalFreq: entry.total,
        papers: entry.papers.size,
        years: Array.from(entry.years).sort().join(", "),
        topics: Array.from(entry.topics).join(", "),
      }))
      .sort((left, right) => right.totalFreq - left.totalFreq);

    if (search) {
      const query = search.toLowerCase();
      results = results.filter((row) => row.keyword.toLowerCase().includes(query));
    }

    return results;
  }, [search, trends]);

  const treeData = useMemo(
    () =>
      keywordAggregate.slice(0, treeN).map((row) => ({
        name: row.keyword,
        value: row.totalFreq,
      })),
    [keywordAggregate, treeN]
  );

  const comparisonKeywords =
    selectedKeywords.length > 0
      ? selectedKeywords
      : keywordAggregate.slice(0, 5).map((row) => row.keyword);

  const timelineData = useMemo(() => {
    const years = [...new Set(trends.map((row) => row.year))].sort();
    return years.map((year) => {
      const entry: Record<string, string | number> = { year };
      comparisonKeywords.forEach((keyword) => {
        entry[keyword] = trends
          .filter((row) => row.year === year && row.keyword === keyword)
          .reduce((sum, row) => sum + row.keyword_frequency, 0);
      });
      return entry;
    });
  }, [comparisonKeywords, trends]);

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
          Keyword explorer
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Search important terms, review keyword reach, and compare frequency over time.
        </p>
      </section>

      <input
        type="text"
        placeholder="Search keywords"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="w-full max-w-md rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
      />

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Keyword treemap
          </h3>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Top keywords: {treeN}
          </label>
          <input
            type="range"
            min={10}
            max={60}
            value={treeN}
            onChange={(event) => setTreeN(+event.target.value)}
            className="w-40"
          />
        </div>
        {treeData.length > 0 && (
          <div className="mt-4 h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={treeData}
                dataKey="value"
                nameKey="name"
                content={<TreemapCell x={0} y={0} width={0} height={0} name="" value={0} index={0} />}
              />
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="app-surface px-5 py-5">
        <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
          Keyword table
        </h3>
        <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Keyword</th>
                <th className="px-3 py-2 text-right font-semibold">Total Freq</th>
                <th className="px-3 py-2 text-right font-semibold">Papers</th>
                <th className="px-3 py-2 text-left font-semibold">Years Active</th>
                <th className="px-3 py-2 text-left font-semibold">Associated Topics</th>
              </tr>
            </thead>
            <tbody>
              {keywordAggregate.map((row) => (
                <tr
                  key={row.keyword}
                  className="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
                >
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                    {row.keyword}
                  </td>
                  <td className="px-3 py-2 text-right">{row.totalFreq}</td>
                  <td className="px-3 py-2 text-right">{row.papers}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                    {row.years}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-slate-500 dark:text-slate-400">
                    {row.topics}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-surface px-5 py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          Keyword timeline
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Select keywords to compare across the selected years.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {keywordAggregate.slice(0, 20).map((row) => (
            <button
              key={row.keyword}
              onClick={() =>
                setSelectedKeywords((current) =>
                  current.includes(row.keyword)
                    ? current.filter((keyword) => keyword !== row.keyword)
                    : [...current, row.keyword]
                )
              }
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                comparisonKeywords.includes(row.keyword)
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
              }`}
            >
              {row.keyword}
            </button>
          ))}
        </div>
        <div className="mt-5 h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {comparisonKeywords.map((keyword, index) => (
                <Line
                  key={keyword}
                  type="monotone"
                  dataKey={keyword}
                  stroke={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

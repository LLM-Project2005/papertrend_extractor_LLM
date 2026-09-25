"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  Bar,
  BarChart,
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
import Heatmap from "@/components/Heatmap";
import { Takeaway } from "@/components/dashboard/DashboardNotes";
import { TOPIC_PALETTE } from "@/lib/constants";
import {
  keywordPaperCounts,
  listOf,
  plural,
  subjectRows,
  themePaperCounts,
  themePapersByYear,
  yearAxis,
} from "@/lib/dashboard-analytics";
import type { CorpusTopicFamily, PaperId, TrendRow } from "@/types/database";

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}
import type { KeywordSearchResponse } from "@/types/keyword-search";
import type { VisualizationPlanChart } from "@/types/visualization";
import { useTheme } from "@/components/theme/ThemeProvider";
import { chartTheme, tickStyle } from "@/lib/chart-theme";
import { labelColumn, useIsNarrow } from "@/lib/use-narrow";
import { legendLabel } from "@/lib/chart-legend";
import { isDatedYear } from "@/lib/dated-year";

interface Props {
  trends: TrendRow[];
  topicFamilies?: CorpusTopicFamily[];
  selectedYears?: string[];
  selectedTracks?: string[];
  folderIds?: string[];
  projectId?: string | "all";
  planCharts?: VisualizationPlanChart[];
  onDrilldown?: (target: { topic?: string; keyword?: string; paperIds?: string[] }) => void;
}

/**
 * One hue. Colour in the old treemap cycled through a twenty-colour palette by
 * rank, which reads as categories that do not exist; size is the only thing a
 * cell encodes, so size is the only thing that varies.
 */
const TreemapCell = (props: {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  value: number;
  /** 0 for the root, which Recharts also hands to this renderer. */
  depth?: number;
  fill?: string;
  textFill?: string;
  edge?: string;
  onDrilldown?: (target: { topic?: string; keyword?: string; paperIds?: string[] }) => void;
}) => {
  const { x, y, width, height, name, value, depth, fill = "#334155", textFill = "#ffffff", edge = "#ffffff", onDrilldown } = props;
  // The root spans the whole chart under the cells, labelled with the sum of
  // every theme - "63 papers" in a 39-paper repository, hidden but in the page.
  if (depth === 0) return null;
  if (width < 4 || height < 4) return null;
  const maxChars = Math.floor((width - 12) / 6.5);
  const label = name && name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}\u2026` : name;
  return (
    <g className={onDrilldown ? "cursor-pointer" : undefined} onClick={() => onDrilldown?.({ topic: name })}>
      <title>{`${name}: ${value} paper${value === 1 ? "" : "s"}`}</title>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke={edge} strokeWidth={2} rx={6} />
      {width > 60 && height > 34 && maxChars >= 6 ? (
        <>
          <text x={x + 8} y={y + 18} fill={textFill} fontSize={11} fontWeight={600}>
            {label}
          </text>
          <text x={x + 8} y={y + 32} fill={textFill} fontSize={10} opacity={0.85}>
            {value} paper{value === 1 ? "" : "s"}
          </text>
        </>
      ) : null}
    </g>
  );
};

export default function KeywordExplorer({
  trends,
  topicFamilies = [],
  selectedYears = [],
  selectedTracks = [],
  folderIds = [],
  projectId = "all",
  planCharts,
  onDrilldown,
}: Props) {
  const { theme, hydrated } = useTheme();
  const ct = chartTheme(hydrated && theme === "dark");
  const keywordLabels = labelColumn(useIsNarrow(), { width: 210, chars: 32 });
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [treeN, setTreeN] = useState(30);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [conceptResult, setConceptResult] = useState<KeywordSearchResponse | null>(null);
  const [conceptLoading, setConceptLoading] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);

  const heatmapConfig = planCharts?.find(
    (chart) => chart.chart_key === "keyword_heatmap"
  )?.config;
  const plannerHeatN = heatmapConfig?.heat_n ?? 15;
  const paperIdsByKeyword = useMemo(() => {
    const map = new Map<string, Set<PaperId>>();
    for (const row of trends) {
      const keyword = String(row.keyword || "").trim();
      if (!keyword) {
        continue;
      }
      const bucket = map.get(keyword) ?? new Set<PaperId>();
      bucket.add(row.paper_id);
      map.set(keyword, bucket);
    }
    return map;
  }, [trends]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setConceptResult(null);
      setConceptError(null);
      setConceptLoading(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setConceptLoading(true);
      setConceptError(null);

      try {
        const response = await fetch("/api/keyword-search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {}),
          },
            body: JSON.stringify({
              query: trimmed,
              selectedYears,
              selectedTracks,
              folderIds,
              projectId,
            }),
          });

        const payload = (await response.json()) as KeywordSearchResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Keyword search failed.");
        }

        if (!cancelled) {
          setConceptResult(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setConceptResult(null);
          setConceptError(
            error instanceof Error ? error.message : "Keyword search failed."
          );
        }
      } finally {
        if (!cancelled) {
          setConceptLoading(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [folderIds, projectId, query, selectedTracks, selectedYears, session?.access_token]);

  // What was studied; method themes are shown on the Overview.
  const subjects = useMemo(() => subjectRows(trends), [trends]);
  const axis = useMemo(() => yearAxis(subjects.map((row) => row.year)), [subjects]);
  const keywords = useMemo(() => keywordPaperCounts(subjects), [subjects]);
  const themes = useMemo(() => {
    const rowsByTheme = new Map<string, TrendRow[]>();
    for (const row of subjects) rowsByTheme.set(row.topic, [...(rowsByTheme.get(row.topic) ?? []), row]);
    return themePaperCounts(subjects).map((entry) => {
      const rows = rowsByTheme.get(entry.topic) ?? [];
      return {
        ...entry,
        aliases: [...new Set(rows.map((row) => row.raw_topic ?? row.topic))].sort((a, b) => a.localeCompare(b)),
        keywords: keywordPaperCounts(rows).slice(0, 8).map((keyword) => keyword.keyword),
        years: [...new Set(rows.map((row) => row.year))].filter(isDatedYear).sort(),
      };
    });
  }, [subjects]);
  const visibleThemes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return themes;
    return themes.filter(
      (entry) =>
        entry.topic.toLowerCase().includes(normalized) ||
        entry.aliases.join(" ").toLowerCase().includes(normalized) ||
        entry.keywords.join(" ").toLowerCase().includes(normalized)
    );
  }, [query, themes]);

  // Papers, not keyword occurrences, and only themes with a dated paper: a row
  // of zeros for a theme whose papers are all undated said nothing.
  const heatmapData = useMemo(() => {
    const candidates = themes.slice(0, plannerHeatN);
    const rows = candidates
      .map((entry) => ({
        theme: entry.topic,
        values: axis.years.map(
          (year) => new Set(subjects.filter((row) => row.topic === entry.topic && row.year === year).map((row) => row.paper_id)).size
        ),
      }))
      .filter((row) => row.values.some((value) => value > 0));
    return { rows, undatedOnly: candidates.length - rows.length };
  }, [axis.years, plannerHeatN, subjects, themes]);

  const treeData = useMemo(
    () => themes.slice(0, treeN).map((entry) => ({ name: entry.topic, value: entry.papers })),
    [themes, treeN]
  );

  const comparisonThemes = useMemo(
    () =>
      selectedKeywords.length > 0
        ? selectedKeywords
        : themes.filter((entry) => entry.papers >= 2).slice(0, 5).map((entry) => entry.topic),
    [selectedKeywords, themes]
  );
  const timelineData = useMemo(
    () => themePapersByYear(subjects, comparisonThemes, axis.years),
    [axis.years, comparisonThemes, subjects]
  );
  const sharedKeywords = keywords.filter((keyword) => keyword.papers >= 2);

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
        <Takeaway>
          {sharedKeywords.length > 0
            ? `The keywords used by the most papers are ${listOf(sharedKeywords.slice(0, 3).map((keyword) => `${keyword.keyword} (${keyword.papers})`))}. ${plural(sharedKeywords.length, "keyword")} of ${keywords.length} appear in two or more papers; the rest are particular to one paper.`
            : `None of the ${plural(keywords.length, "keyword")} here is used by more than one paper.`}
        </Takeaway>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Search a concept in Thai or English to see when it emerges, where it first
          appears, and what other ideas move with it.
        </p>

        <div className="mt-4">
          <input
            type="text"
            placeholder="Search a concept, e.g. intelligibility / comprehensibility"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white"
          />
        </div>
      </section>

      {query.trim().length >= 2 ? (
        <section className="space-y-4">
          {conceptLoading ? (
            <div className="app-surface px-5 py-5">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Searching the concept family across the workspace...
              </p>
            </div>
          ) : null}

          {conceptError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {conceptError}
            </div>
          ) : null}

          {conceptResult && !conceptLoading ? (
            <>
              <section className="app-surface px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                      Canonical concept
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                      {conceptResult.canonicalConcept || query}
                    </h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#030303] dark:text-slate-300">
                    {conceptResult.source === "repository" ? "From this repository" : "Node analysis"}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {conceptResult.summary}
                </p>

                {conceptResult.matchedTerms.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {conceptResult.matchedTerms.map((term) => (
                      <span
                        key={term}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-slate-300"
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                ) : null}

                {conceptResult.notFound && conceptResult.suggestedConcepts.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                      Nearby grounded concepts
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {conceptResult.suggestedConcepts.map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => setQuery(term)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-slate-300 dark:hover:border-[#3a3a3a]"
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              {conceptResult.firstAppearance ? (
                <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
                  <article className="app-surface px-5 py-5">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                      First appearance
                    </p>
                    <h4 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
                      {conceptResult.firstAppearance.title}
                    </h4>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      {conceptResult.firstAppearance.year} • {conceptResult.firstAppearance.section}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {conceptResult.firstAppearance.snippet}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {conceptResult.firstAppearance.tracksSingle.map((track) => (
                        <span
                          key={track}
                          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#030303] dark:text-slate-300"
                        >
                          {track}
                        </span>
                      ))}
                    </div>
                    <Link
                      href={`/workspace/library?paperId=${conceptResult.firstAppearance.paperId}`}
                      className="mt-4 inline-flex text-sm font-medium text-slate-900 underline dark:text-white"
                    >
                      Open paper
                    </Link>
                  </article>

                  <article className="app-surface px-5 py-5">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                      Objective verbs
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {conceptResult.objectiveVerbs.length > 0 ? (
                        conceptResult.objectiveVerbs.map((item) => (
                          <span
                            key={item.label}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-slate-300"
                          >
                            {item.label} ({item.count})
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No grouped objective verbs were found for this concept yet.
                        </p>
                      )}
                    </div>
                  </article>

                  <article className="app-surface px-5 py-5">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                      Contribution groups
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {conceptResult.contributionTypes.length > 0 ? (
                        conceptResult.contributionTypes.map((item) => (
                          <span
                            key={item.label}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-slate-300"
                          >
                            {item.label} ({item.count})
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No grouped contribution types were found for this concept yet.
                        </p>
                      )}
                    </div>
                  </article>
                </section>
              ) : null}

              {conceptResult.timeline.length > 0 ? (
                <section className="app-surface px-5 py-5">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Emergence over time
                  </h3>
                  <div className="mt-5 h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={conceptResult.timeline}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                        <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <YAxis tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendLabel(ct)} />
                        <Line
                          type="monotone"
                          dataKey="frequency"
                          name="Frequency"
                          stroke={TOPIC_PALETTE[0]}
                          strokeWidth={3}
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="papers"
                          name="Papers"
                          stroke={TOPIC_PALETTE[3]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ) : null}

              {conceptResult.trackSpread.length > 0 ? (
                <section className="app-surface px-5 py-5">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Track spread
                  </h3>
                  <div className="mt-5 h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={conceptResult.trackSpread}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                        <XAxis dataKey="track" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <YAxis tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <Tooltip />
                        <Bar dataKey="papers" fill={TOPIC_PALETTE[5]} radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ) : null}

              <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <article className="app-surface px-5 py-5">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Co-occurring concepts
                  </h3>
                  <div className="mt-4 space-y-3">
                    {conceptResult.cooccurringConcepts.length > 0 ? (
                      conceptResult.cooccurringConcepts.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#030303]"
                        >
                          <span className="text-sm text-slate-700 dark:text-slate-200">
                            {item.label}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {item.weight}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No co-occurring concepts were found for this query.
                      </p>
                    )}
                  </div>
                </article>

                <article className="app-surface px-5 py-5">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Evidence
                  </h3>
                  <div className="mt-4 space-y-3">
                    {conceptResult.evidence.length > 0 ? (
                      conceptResult.evidence.map((item, index) => (
                        <div
                          key={`${item.paperId}-${index}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#030303]"
                        >
                          <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-500">
                            {item.year} • {item.section}
                          </p>
                          <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                            {item.title}
                          </p>
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {item.snippet}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No evidence snippets are available yet.
                      </p>
                    )}
                  </div>
                </article>
              </section>

              <section className="app-surface px-5 py-5">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Related papers
                </h3>
                <div className="mt-4 space-y-3">
                  {conceptResult.papers.length > 0 ? (
                    conceptResult.papers.map((paper) => (
                      <div
                        key={paper.paperId}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#030303]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                              {paper.title}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {paper.year}
                            </p>
                          </div>
                          <Link
                            href={`/workspace/library?paperId=${paper.paperId}`}
                            className="text-sm font-medium text-slate-900 underline dark:text-white"
                          >
                            Open
                          </Link>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {paper.tracksSingle.map((track) => (
                            <span
                              key={`${paper.paperId}-${track}`}
                              className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#050505] dark:text-slate-300"
                            >
                              {track}
                            </span>
                          ))}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {paper.matchedTerms.map((term) => (
                            <span
                              key={`${paper.paperId}-${term}`}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-slate-300"
                            >
                              {term}
                            </span>
                          ))}
                        </div>

                        {paper.evidence.length > 0 ? (
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {paper.evidence[0]}
                          </p>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No paper-level matches are available yet.
                    </p>
                  )}
                </div>
              </section>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="app-surface px-5 py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Keywords used by the most papers</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ranked by how many papers use each keyword, not by how often one paper repeats it.
        </p>
        {sharedKeywords.length > 0 ? (
          <div className="mt-4" style={{ height: Math.min(15, sharedKeywords.length) * 30 + 50 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sharedKeywords.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis type="number" allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <YAxis
                  type="category"
                  dataKey="keyword"
                  width={keywordLabels.width}
                  tick={tickStyle(ct, 12)}
                  tickFormatter={(value) => truncate(String(value), keywordLabels.chars)}
                  stroke={ct.axisLine}
                />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${value} papers (${(item as { payload?: { occurrences?: number } })?.payload?.occurrences ?? 0} mentions)`,
                    "Used by",
                  ]}
                />
                <Bar
                  dataKey="papers"
                  name="Papers"
                  fill={ct.barFill}
                  radius={[0, 6, 6, 0]}
                  onClick={(entry) => {
                    const row = entry as { keyword?: string; paperIds?: string[] };
                    if (row?.keyword) onDrilldown?.({ keyword: row.keyword, paperIds: row.paperIds });
                  }}
                  className={onDrilldown ? "cursor-pointer" : undefined}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600 dark:text-[#bdbdbd]">
            Every keyword here is used by a single paper, so there is nothing to rank yet.
          </p>
        )}
      </section>

      <section className="app-surface px-5 py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Themes across years</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Papers per theme per year for the {Math.min(plannerHeatN, themes.length)} largest themes. Every year in the range has a column.
        </p>
        {heatmapData.rows.length > 0 ? (
          <div className="mt-4">
            <Heatmap
              rows={heatmapData.rows.map((row) => row.theme)}
              cols={axis.years}
              values={heatmapData.rows.map((row) => row.values)}
              colorScale={["#f1f5f9", "#1e293b"]}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600 dark:text-[#bdbdbd]">No theme has a dated paper in the current filters.</p>
        )}
        {heatmapData.undatedOnly > 0 ? (
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-[#a3a3a3]">
            {plural(heatmapData.undatedOnly, "theme")} among the largest{" "}
            {heatmapData.undatedOnly === 1 ? "appears" : "appear"} only in papers without a readable year, so{" "}
            {heatmapData.undatedOnly === 1 ? "it is" : "they are"} not shown.
          </p>
        ) : null}
      </section>

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Theme sizes</h3>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            Themes shown: {Math.min(treeN, themes.length)}
            <input
              type="range"
              min={5}
              max={Math.max(5, Math.min(60, themes.length))}
              value={Math.min(treeN, Math.max(5, themes.length))}
              onChange={(event) => setTreeN(+event.target.value)}
              className="h-6 w-32"
            />
          </label>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Each rectangle is a theme, sized by its number of papers.</p>
        {treeData.length > 0 && (
          <div className="mt-4 h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={treeData}
                dataKey="value"
                nameKey="name"
                isAnimationActive={false}
                content={
                  <TreemapCell
                    x={0}
                    y={0}
                    width={0}
                    height={0}
                    name=""
                    value={0}
                    fill={ct.barFill}
                    textFill={hydrated && theme === "dark" ? "#0a0a0a" : "#ffffff"}
                    edge={ct.segmentEdge}
                    onDrilldown={onDrilldown}
                  />
                }
              />
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="app-surface px-5 py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Themes and what they gather</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Each theme, the topic labels its papers were given, and the keywords most of its papers use.
          {query.trim() ? ` Filtered by "${query.trim()}".` : ""}
        </p>
        <div className="mt-4 max-h-[460px] overflow-auto rounded-xl border border-slate-200 dark:border-[#1f1f1f]">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-[#030303]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Theme</th>
                <th className="px-3 py-2 text-right font-semibold">Papers</th>
                <th className="px-3 py-2 text-left font-semibold">Years</th>
                <th className="px-3 py-2 text-left font-semibold">Paper labels and keywords</th>
              </tr>
            </thead>
            <tbody>
              {visibleThemes.map((row) => (
                <tr
                  key={row.topic}
                  className="border-t border-slate-200 align-top hover:bg-slate-50 dark:border-[#1f1f1f] dark:hover:bg-[#0a0a0a]"
                >
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                    <button
                      type="button"
                      onClick={() => onDrilldown?.({ topic: row.topic, paperIds: row.paperIds })}
                      className="-my-1 py-1 text-left font-semibold text-slate-900 underline-offset-4 transition-colors hover:text-slate-600 hover:underline disabled:cursor-default disabled:no-underline dark:text-white dark:hover:text-slate-300"
                      disabled={!onDrilldown}
                      title="Open the papers in this theme"
                    >
                      {row.topic}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">{row.papers}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {row.years.length === 0
                      ? "No dated papers"
                      : row.years.length === 1
                        ? row.years[0]
                        : `${row.years[0]}–${row.years[row.years.length - 1]}`}
                  </td>
                  <td className="max-w-md px-3 py-2 text-slate-600 dark:text-slate-400">
                    <div className="space-y-2">
                      {row.aliases.length > 1 || row.aliases[0] !== row.topic ? (
                        <p className="text-xs leading-5">{row.aliases.join("; ")}</p>
                      ) : null}
                      {row.keywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {row.keywords.map((keyword) => (
                            <button
                              key={`${row.topic}-${keyword}`}
                              type="button"
                              onClick={() =>
                                onDrilldown?.({
                                  keyword,
                                  paperIds: [...(paperIdsByKeyword.get(keyword) ?? [])],
                                })
                              }
                              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-default dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-slate-300 dark:hover:border-[#3a3a3a] dark:hover:text-white"
                              disabled={!onDrilldown}
                              title="Open papers for this keyword"
                            >
                              {keyword}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-surface px-5 py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Compare themes over time</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose themes to compare their papers per year. The five largest shared themes are shown until you choose.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {themes.slice(0, 20).map((row) => (
            <button
              key={row.topic}
              type="button"
              aria-pressed={comparisonThemes.includes(row.topic)}
              onClick={() =>
                setSelectedKeywords((current) =>
                  current.includes(row.topic)
                    ? current.filter((topic) => topic !== row.topic)
                    : [...current, row.topic]
                )
              }
              className={`min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                comparisonThemes.includes(row.topic)
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-slate-300 dark:hover:border-[#3a3a3a]"
              }`}
            >
              {row.topic}
            </button>
          ))}
        </div>
        {comparisonThemes.length > 0 && axis.years.length > 0 ? (
          <div className="mt-5 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendLabel(ct)} />
                {comparisonThemes.map((topic, index) => (
                  <Line
                    key={topic}
                    type="linear"
                    dataKey={topic}
                    stroke={TOPIC_PALETTE[index % TOPIC_PALETTE.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
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
import { TOPIC_PALETTE } from "@/lib/constants";
import { buildWorkspacePath } from "@/lib/workspace-routes";
import type { CorpusTopicFamily, PaperId, TrendRow } from "@/types/database";
import type { KeywordSearchResponse } from "@/types/keyword-search";
import type { VisualizationPlanChart } from "@/types/visualization";

interface Props {
  trends: TrendRow[];
  topicFamilies?: CorpusTopicFamily[];
  selectedYears?: string[];
  selectedTracks?: string[];
  folderIds?: string[];
  projectId?: string | "all";
  planCharts?: VisualizationPlanChart[];
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

export default function KeywordExplorer({
  trends,
  topicFamilies = [],
  selectedYears = [],
  selectedTracks = [],
  folderIds = [],
  projectId = "all",
  planCharts,
}: Props) {
  const { session } = useAuth();
  const { currentOrganization, currentProject, selectedOrganizationId, selectedProjectId } =
    useWorkspaceProfile();
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
  const buildPaperHref = (paperId: PaperId) =>
    buildWorkspacePath({
      organizationId: selectedOrganizationId ?? currentOrganization?.id ?? null,
      projectId: selectedProjectId ?? currentProject?.id ?? null,
      projectName: currentProject?.name ?? null,
      section: "library",
      query: { paperId },
    });

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

  const keywordAggregate = useMemo(() => {
    const families =
      topicFamilies.length > 0
        ? topicFamilies
        : Object.entries(
            trends.reduce<
              Record<
                string,
                {
                  paperIds: Set<PaperId>;
                  years: Set<string>;
                  aliases: Set<string>;
                  keywords: Map<string, number>;
                }
              >
            >((accumulator, row) => {
              const entry = (accumulator[row.topic] ??= {
                paperIds: new Set<PaperId>(),
                years: new Set<string>(),
                aliases: new Set<string>([row.topic, row.raw_topic ?? row.topic]),
                keywords: new Map<string, number>(),
              });
              entry.paperIds.add(row.paper_id);
              entry.years.add(row.year);
              entry.keywords.set(
                row.keyword,
                (entry.keywords.get(row.keyword) ?? 0) + row.keyword_frequency
              );
              return accumulator;
            }, {})
          ).map(([canonicalTopic, entry], index) => ({
            id: `topic-family-${index + 1}`,
            canonicalTopic,
            aliases: [...entry.aliases],
            representativeKeywords: [...entry.keywords.entries()]
              .sort((left, right) => right[1] - left[1])
              .slice(0, 6)
              .map(([keyword]) => keyword),
            relatedKeywords: [...entry.keywords.keys()],
            matchedTerms: [...entry.aliases],
            evidenceSnippets: [],
            paperIds: [...entry.paperIds],
            folderIds: [],
            years: [...entry.years].sort(),
            totalKeywordFrequency: [...entry.keywords.values()].reduce(
              (sum, value) => sum + value,
              0
            ),
          }));

    let results = families
      .map((family) => ({
        keyword: family.canonicalTopic,
        totalFreq: family.totalKeywordFrequency,
        papers: family.paperIds.length,
        years: family.years.join(", "),
        topics: family.aliases.join(", "),
        representativeKeywords: family.representativeKeywords,
      }))
      .sort((left, right) => right.totalFreq - left.totalFreq);

    if (query.trim()) {
      const normalized = query.trim().toLowerCase();
      results = results.filter(
        (row) =>
          row.keyword.toLowerCase().includes(normalized) ||
          row.topics.toLowerCase().includes(normalized) ||
          row.representativeKeywords.join(" ").toLowerCase().includes(normalized)
      );
    }

    return results;
  }, [query, topicFamilies, trends]);

  const heatmapData = useMemo(() => {
    const years = [...new Set(trends.map((row) => row.year))].sort();
    const topKeywords = keywordAggregate
      .slice(0, plannerHeatN)
      .map((row) => row.keyword);

    const grid: Record<string, Record<string, number>> = {};
    trends.forEach((row) => {
      if (!topKeywords.includes(row.topic)) {
        return;
      }
      grid[row.topic] ??= {};
      grid[row.topic][row.year] =
        (grid[row.topic][row.year] ?? 0) + row.keyword_frequency;
    });

    return {
      rows: topKeywords,
      cols: years,
      values: topKeywords.map((keyword) =>
        years.map((year) => grid[keyword]?.[year] ?? 0)
      ),
    };
  }, [keywordAggregate, plannerHeatN, trends]);

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
            .filter((row) => row.year === year && row.topic === keyword)
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
          Concept investigator
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Search a concept in Thai or English to see when it emerges, where it first
          appears, how it spreads across tracks, and what other ideas move with it.
        </p>

        <div className="mt-4">
          <input
            type="text"
            placeholder="Search a concept, e.g. intelligibility / comprehensibility"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
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
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {conceptError}
            </div>
          ) : null}

          {conceptResult && !conceptLoading ? (
            <>
              <section className="app-surface px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
                      Canonical concept
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                      {conceptResult.canonicalConcept || query}
                    </h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-300">
                    {conceptResult.source === "fallback" ? "Fallback analysis" : "Node analysis"}
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
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                ) : null}

                {conceptResult.notFound && conceptResult.suggestedConcepts.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
                      Nearby grounded concepts
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {conceptResult.suggestedConcepts.map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => setQuery(term)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
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
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
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
                          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300"
                        >
                          {track}
                        </span>
                      ))}
                    </div>
                    <Link
                      href={buildPaperHref(conceptResult.firstAppearance.paperId)}
                      prefetch={false}
                      className="mt-4 inline-flex text-sm font-medium text-slate-900 underline dark:text-white"
                    >
                      Open paper
                    </Link>
                  </article>

                  <article className="app-surface px-5 py-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
                      Objective verbs
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {conceptResult.objectiveVerbs.length > 0 ? (
                        conceptResult.objectiveVerbs.map((item) => (
                          <span
                            key={item.label}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
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
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
                      Contribution groups
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {conceptResult.contributionTypes.length > 0 ? (
                        conceptResult.contributionTypes.map((item) => (
                          <span
                            key={item.label}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
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
                        <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
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
                        <XAxis dataKey="track" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
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
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950"
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
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-950"
                        >
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
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
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-950"
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
                            href={buildPaperHref(paper.paperId)}
                            prefetch={false}
                            className="text-sm font-medium text-slate-900 underline dark:text-white"
                          >
                            Open
                          </Link>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {paper.tracksSingle.map((track) => (
                            <span
                              key={`${paper.paperId}-${track}`}
                              className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300"
                            >
                              {track}
                            </span>
                          ))}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {paper.matchedTerms.map((term) => (
                            <span
                              key={`${paper.paperId}-${term}`}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
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
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Keyword atlas
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Ranked canonical topic families across the current corpus
          </span>
        </div>
      </section>

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Keyword heatmap
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Top topic families: {plannerHeatN}
            </span>
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

      <section className="app-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Keyword treemap
            </h3>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Top topic families: {treeN}
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
                <th className="px-3 py-2 text-left font-semibold">Canonical topic</th>
                <th className="px-3 py-2 text-right font-semibold">Total Freq</th>
                <th className="px-3 py-2 text-right font-semibold">Papers</th>
                <th className="px-3 py-2 text-left font-semibold">Years Active</th>
                <th className="px-3 py-2 text-left font-semibold">Aliases and keywords</th>
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
                      {[row.topics, row.representativeKeywords.join(", ")]
                        .filter(Boolean)
                        .join(" • ")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-surface px-5 py-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          Topic family timeline
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Select canonical topic families to compare across the selected years.
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

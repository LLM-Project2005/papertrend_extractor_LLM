"use client";

import PaperLink from "@/components/workspace/PaperLink";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Takeaway } from "@/components/dashboard/DashboardNotes";
import { NEUTRAL_MARK } from "@/lib/chart-palette";
import { keywordPaperCounts, listOf, plural, subjectRows } from "@/lib/dashboard-analytics";
import type { CorpusTopicFamily, TrendRow } from "@/types/database";
import ChartValues, { paperCount } from "@/components/tabs/ChartValues";
import ChartCsvButton from "@/components/tabs/ChartCsvButton";
import { tooltipTheme } from "@/lib/chart-tooltip";
import type { KeywordSearchResponse } from "@/types/keyword-search";
import type { VisualizationPlanChart } from "@/types/visualization";
import { useTheme } from "@/components/theme/ThemeProvider";
import { chartTheme, tickStyle, chartAnimationActive } from "@/lib/chart-theme";
import { labelColumn, useIsNarrow } from "@/lib/use-narrow";
import { legendLabel } from "@/lib/chart-legend";
import { wrappedTick } from "@/lib/chart-ticks";
import {
  NO_THEME_COLORS,
  hasThemeColor,
  keywordThemeKey,
  keywordThemes,
  themeColor,
  type ThemeColors,
} from "@/lib/theme-colors";

/*
 * The Keyword Explorer: what is about keywords - a concept searched across the
 * repository, and the keywords the most papers use, each bar in the colour of
 * the theme its papers file it under. The theme charts it once held moved to
 * Area Analysis (2026-10-24 review), where the themes are.
 */

interface Props {
  trends: TrendRow[];
  topicFamilies?: CorpusTopicFamily[];
  selectedYears?: string[];
  selectedTracks?: string[];
  folderIds?: string[];
  projectId?: string | "all";
  planCharts?: VisualizationPlanChart[];
  /** The repository's theme colours, which each keyword's bar wears. */
  themeColors?: ThemeColors;
  onDrilldown?: (target: { topic?: string; keyword?: string; paperIds?: string[] }) => void;
}

export default function KeywordExplorer({
  trends,
  topicFamilies = [],
  selectedYears = [],
  selectedTracks = [],
  folderIds = [],
  projectId = "all",
  themeColors = NO_THEME_COLORS,
  onDrilldown,
}: Props) {
  const { theme: themeMode, hydrated } = useTheme();
  const ct = chartTheme(hydrated && themeMode === "dark");
  const themedTooltip = tooltipTheme(hydrated && themeMode === "dark");
  const keywordLabels = labelColumn(useIsNarrow(), { width: 210, chars: 32 });
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [conceptResult, setConceptResult] = useState<KeywordSearchResponse | null>(null);
  const [conceptLoading, setConceptLoading] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);

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

  // What was studied; method themes are shown on the Adaptive tab.
  const subjects = useMemo(() => subjectRows(trends), [trends]);
  const keywords = useMemo(() => keywordPaperCounts(subjects), [subjects]);
  const sharedKeywords = keywords.filter((keyword) => keyword.papers >= 2);
  const keywordTheme = useMemo(() => keywordThemes(trends, themeColors), [themeColors, trends]);
  const rankedKeywords = useMemo(
    () =>
      sharedKeywords.slice(0, 15).map((row) => {
        const theme = keywordTheme.get(keywordThemeKey(row.keyword)) ?? "";
        return { ...row, theme, color: themeColor(themeColors, theme, hydrated && themeMode === "dark") };
      }),
    [hydrated, keywordTheme, sharedKeywords, themeColors, themeMode]
  );
  const barThemes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rankedKeywords) if (row.theme && hasThemeColor(themeColors, row.theme)) seen.set(row.theme, row.color);
    return [...seen.entries()].map(([label, color]) => ({ label, color }));
  }, [rankedKeywords, themeColors]);

  if (trends.length === 0) {
    return (
      <div className="app-surface px-5 py-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No papers match the current filters.
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
            type="search"
            aria-label="Search a concept"
            placeholder="Search a concept, e.g. intelligibility / comprehensibility…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-xl border border-hairline-strong bg-surface px-4 py-3 text-base text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-mute hover:border-ink/30 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm"
          />
        </div>
      </section>

      {query.trim().length >= 2 ? (
        <section className="space-y-4">
          {conceptLoading ? (
            <div className="app-surface px-5 py-5">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Searching this repository for the concept...
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
                      Concept
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
                <section
                  className={`grid gap-4 ${
                    conceptResult.objectiveVerbs.length > 0 || conceptResult.contributionTypes.length > 0
                      ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]"
                      : ""
                  }`}
                >
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
                    <PaperLink
                      paper={{ paperId: String(conceptResult.firstAppearance.paperId) }}
                      className="mt-4 inline-flex text-sm font-medium text-slate-900 underline dark:text-white"
                    >
                      Open paper
                    </PaperLink>
                  </article>

                  {conceptResult.objectiveVerbs.length > 0 ? (
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
                  ) : null}

                  {conceptResult.contributionTypes.length > 0 ? (
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
                  ) : null}
                </section>
              ) : null}

              {conceptResult.timeline.length > 0 ? (
                <section className="app-surface px-5 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      Emergence over time
                    </h3>
                    <ChartCsvButton
                      csv={{
                        name: `${conceptResult.canonicalConcept || "concept"} over time`,
                        header: ["Year", "Frequency", "Papers"],
                        rows: conceptResult.timeline.map((row) => [row.year, row.frequency, row.papers]),
                      }}
                    />
                  </div>
                  <div className="mt-5 h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={conceptResult.timeline}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                        <XAxis dataKey="year" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <YAxis tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <Tooltip {...themedTooltip} />
                        <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendLabel(ct)} />
                        <Line isAnimationActive={chartAnimationActive()}
                          type="monotone"
                          dataKey="frequency"
                          name="Frequency"
                          stroke={ct.barFill}
                          strokeWidth={3}
                          dot={{ r: 3 }}
                        />
                        <Line isAnimationActive={chartAnimationActive()}
                          type="monotone"
                          dataKey="papers"
                          name="Papers"
                          stroke={NEUTRAL_MARK}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ) : null}

              {conceptResult.trackSpread.length > 0 ? (
                <section className="app-surface px-5 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      Track spread
                    </h3>
                    <ChartCsvButton
                      csv={{
                        name: `${conceptResult.canonicalConcept || "concept"} by research area`,
                        header: ["Research area", "Papers"],
                        rows: conceptResult.trackSpread.map((row) => [String(row.track), row.papers]),
                      }}
                    />
                  </div>
                  <div className="mt-5 h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={conceptResult.trackSpread}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                        <XAxis dataKey="track" tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <YAxis tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                        <Tooltip {...themedTooltip} />
                        <Bar isAnimationActive={chartAnimationActive()} dataKey="papers" fill={ct.barFill} radius={[6, 6, 0, 0]} />
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
                          <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">
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
                <div data-paper-list="" className="mt-4 space-y-3">
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
                          <PaperLink
                            paper={{ paperId: String(paper.paperId) }}
                            className="text-sm font-medium text-slate-900 underline dark:text-white"
                          >
                            Open
                          </PaperLink>
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
          Ranked by how many papers use each keyword, not by how often one paper repeats it. Each bar is in the colour of the theme its papers file it under.
        </p>
        {rankedKeywords.length > 0 ? (
          <>
            <div className="mt-4" style={{ height: rankedKeywords.length * 34 + 40 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankedKeywords} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis type="number" allowDecimals={false} tick={tickStyle(ct, 12)} stroke={ct.axisLine} />
                  <YAxis
                    type="category"
                    dataKey="keyword"
                    width={keywordLabels.width}
                    tick={wrappedTick(ct, keywordLabels.chars, 12)}
                    interval={0}
                    stroke={ct.axisLine}
                  />
                  <Tooltip
                    {...themedTooltip}
                    formatter={(value, _name, item) => {
                      const payload = (item as { payload?: { occurrences?: number; theme?: string } })?.payload;
                      return [
                        `${value} papers (${payload?.occurrences ?? 0} mentions)${payload?.theme ? ` · ${payload.theme}` : ""}`,
                        "Used by",
                      ];
                    }}
                  />
                  <Bar
                    isAnimationActive={chartAnimationActive()}
                    dataKey="papers"
                    name="Papers"
                    radius={[0, 6, 6, 0]}
                    onClick={(entry) => {
                      const row = entry as { keyword?: string; paperIds?: string[] };
                      if (row?.keyword) onDrilldown?.({ keyword: row.keyword, paperIds: row.paperIds });
                    }}
                    className={onDrilldown ? "cursor-pointer" : undefined}
                  >
                    {rankedKeywords.map((row) => (
                      <Cell key={row.keyword} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul data-series-legend="" className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-700 dark:text-[#d4d4d4]" aria-label="Theme colours">
              {[...barThemes, ...(rankedKeywords.some((row) => !hasThemeColor(themeColors, row.theme)) ? [{ label: "Other themes", color: NEUTRAL_MARK }] : [])].map((item) => (
                <li key={item.label} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </li>
              ))}
            </ul>
            <ChartValues
              title="Keywords used by the most papers"
              csv={{
                name: "Keywords used by the most papers",
                header: ["Keyword", "Papers", "Theme"],
                rows: rankedKeywords.map((row) => [row.keyword, row.papers, row.theme]),
              }}
              values={rankedKeywords.map((row) => ({
                key: row.keyword,
                label: row.keyword,
                detail: paperCount(row.papers),
                onSelect: onDrilldown ? () => onDrilldown({ keyword: row.keyword, paperIds: row.paperIds }) : undefined,
              }))}
            />
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-600 dark:text-[#bdbdbd]">
            Every keyword here is used by a single paper, so there is nothing to rank yet.
          </p>
        )}
      </section>
    </div>
  );
}

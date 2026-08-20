import { TRACK_COLS, type TrackKey } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import { createChatCompletionResult } from "@/lib/openai";
import { sanitizeVisualizationPlan } from "@/lib/visualization-plan";
import type { DashboardData, PaperId, TrackRow } from "@/types/database";
import type {
  NormalizedAnalyticsPayload,
  VisualizationPlan,
  VisualizationChartKey,
  VisualizationPlannerRequest,
} from "@/types/visualization";

function toTrackField(track: string) {
  return track.toLowerCase() as keyof TrackRow;
}

function parseJsonPayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Planner did not return valid JSON.");
    }
    return JSON.parse(match[0]);
  }
}

function countTopicPapers(rows: DashboardData["trends"]) {
  return rows.reduce<Record<string, Set<PaperId>>>((accumulator, row) => {
    (accumulator[row.topic] ??= new Set()).add(row.paper_id);
    return accumulator;
  }, {});
}

function normalizeTopicText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) =>
      token.endsWith("s") && token.length > 4 && !token.endsWith("ss")
        ? token.slice(0, -1)
        : token
    )
    .join(" ")
    .trim();
}

function canonicalizeTrendTopics(data: DashboardData): DashboardData["trends"] {
  const aliasToCanonical = new Map<string, string>();
  for (const family of data.topicFamilies ?? []) {
    const canonical = family.canonicalTopic;
    const aliases = [
      canonical,
      ...family.aliases,
      ...family.matchedTerms,
      ...family.relatedKeywords,
      ...family.representativeKeywords,
    ];
    for (const alias of aliases) {
      const normalized = normalizeTopicText(alias);
      if (normalized) {
        aliasToCanonical.set(normalized, canonical);
      }
    }
  }

  return data.trends.map((row) => {
    const normalizedTopic = normalizeTopicText(row.topic);
    const normalizedKeyword = normalizeTopicText(row.keyword);
    const canonical =
      aliasToCanonical.get(normalizedTopic) ??
      aliasToCanonical.get(normalizedKeyword) ??
      row.topic;
    return {
      ...row,
      raw_topic: row.raw_topic ?? row.topic,
      topic: canonical,
    };
  });
}

export async function buildNormalizedAnalyticsPayload(
  request: VisualizationPlannerRequest = {},
  ownerUserId?: string | null
): Promise<NormalizedAnalyticsPayload> {
  const folderIds =
    request.folderIds && request.folderIds.length > 0
      ? [...new Set(request.folderIds.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
  const data = await loadDashboardDataServer(
    ownerUserId,
    folderIds,
    request.projectId && request.projectId !== "all" ? request.projectId : null
  );
  const normalizedData: DashboardData = {
    ...data,
    trends: canonicalizeTrendTopics(data),
  };
  const years =
    request.selectedYears && request.selectedYears.length > 0
      ? request.selectedYears
      : [...new Set(normalizedData.trends.map((row) => row.year))].sort();
  const tracks =
    request.selectedTracks && request.selectedTracks.length > 0
      ? request.selectedTracks
      : ([...TRACK_COLS] as TrackKey[]);
  const searchQuery = request.searchQuery?.trim() ?? "";

  const filtered = filterDashboardData(normalizedData, years, tracks, searchQuery);
  const filteredDashboard: DashboardData = {
    ...filtered,
    useMock: data.useMock,
    diagnostics: data.diagnostics,
  };

  const paperCount = new Set([
    ...filteredDashboard.trends.map((row) => row.paper_id),
    ...filteredDashboard.tracksSingle.map((row) => row.paper_id),
    ...filteredDashboard.tracksMulti.map((row) => row.paper_id),
    ...(filteredDashboard.categoryAssignments ?? []).map((row) => row.paper_id),
  ]).size;
  const topicCount = new Set(filteredDashboard.trends.map((row) => row.topic)).size;
  const keywordCount = new Set(filteredDashboard.trends.map((row) => row.keyword)).size;
  const availableYears = [
    ...new Set([
      ...filteredDashboard.trends.map((row) => row.year),
      ...filteredDashboard.tracksSingle.map((row) => row.year),
      ...filteredDashboard.tracksMulti.map((row) => row.year),
      ...(filteredDashboard.categoryAssignments ?? []).map((row) => row.year),
    ]),
  ].sort();
  const yearRange =
    availableYears.length > 0
      ? `${availableYears[0]} to ${availableYears[availableYears.length - 1]}`
      : "No data";

  const yearlyPaperTrend = Object.entries(
    [...filteredDashboard.trends, ...filteredDashboard.tracksSingle, ...filteredDashboard.tracksMulti].reduce<
      Record<string, Set<PaperId>>
    >((accumulator, row) => {
      (accumulator[row.year] ??= new Set()).add(row.paper_id);
      return accumulator;
    }, {})
  )
    .map(([year, ids]) => ({ year, papers: ids.size }))
    .sort((left, right) => left.year.localeCompare(right.year));

  const buildTrackTotals = (rows: TrackRow[]) =>
    TRACK_COLS.map((track) => ({
      track,
      value: rows.reduce((sum, row) => sum + Number(row[toTrackField(track)] ?? 0), 0),
    }));

  const topicCounts = countTopicPapers(filteredDashboard.trends);
  const topTopics = Object.entries(topicCounts)
    .sort((left, right) => right[1].size - left[1].size)
    .slice(0, 8)
    .map(([topic]) => topic);

  const topTopicsOverTime = availableYears.map((year) => ({
    year,
    topics: topTopics
      .map((topic) => ({
        topic,
        papers: new Set(
          filteredDashboard.trends
            .filter((row) => row.year === year && row.topic === topic)
            .map((row) => row.paper_id)
        ).size,
      }))
      .filter((entry) => entry.papers > 0),
  }));

  const canonicalTopicFamilies = (filteredDashboard.topicFamilies ?? []).map((family) => ({
    canonical_topic: family.canonicalTopic,
    aliases: family.aliases,
    representative_keywords: family.representativeKeywords,
    paper_count: family.paperIds.length,
    total_keyword_frequency: family.totalKeywordFrequency,
  }));

  const folderTopicTotals = Object.entries(
    filteredDashboard.trends.reduce<
      Record<
        string,
        {
          paperIds: Set<PaperId>;
          topics: Record<string, { paperIds: Set<PaperId>; frequency: number }>;
        }
      >
    >((accumulator, row) => {
      const folderKey = row.folder_id || "__unscoped__";
      const entry = (accumulator[folderKey] ??= { paperIds: new Set(), topics: {} });
      entry.paperIds.add(row.paper_id);
      const topicEntry = (entry.topics[row.topic] ??= {
        paperIds: new Set<PaperId>(),
        frequency: 0,
      });
      topicEntry.paperIds.add(row.paper_id);
      topicEntry.frequency += row.keyword_frequency;
      return accumulator;
    }, {})
  ).map(([folder_id, value]) => ({
    folder_id,
    total_papers: value.paperIds.size,
    topics: Object.entries(value.topics)
      .map(([topic, topicValue]) => ({
        topic,
        papers: topicValue.paperIds.size,
        frequency: topicValue.frequency,
      }))
      .sort((left, right) => right.papers - left.papers || right.frequency - left.frequency)
      .slice(0, 8),
  }));

  const yearlyTopicTotals = availableYears.map((year) => {
    const grouped = filteredDashboard.trends
      .filter((row) => row.year === year)
      .reduce<Record<string, { paperIds: Set<PaperId>; frequency: number }>>(
        (accumulator, row) => {
          const entry = (accumulator[row.topic] ??= {
            paperIds: new Set<PaperId>(),
            frequency: 0,
          });
          entry.paperIds.add(row.paper_id);
          entry.frequency += row.keyword_frequency;
          return accumulator;
        },
        {}
      );

    return {
      year,
      topics: Object.entries(grouped)
        .map(([topic, value]) => ({
          topic,
          papers: value.paperIds.size,
          frequency: value.frequency,
        }))
        .sort((left, right) => right.papers - left.papers || right.frequency - left.frequency)
        .slice(0, 8),
    };
  });

  const keywordHeatmap = {
    years: availableYears,
    rows: topTopics.map((topic) => ({
      keyword: topic,
      totals_by_year: availableYears.map((year) =>
        filteredDashboard.trends
          .filter((row) => row.year === year && row.topic === topic)
          .reduce((sum, row) => sum + row.keyword_frequency, 0)
      ),
      total_frequency: filteredDashboard.trends
        .filter((row) => row.topic === topic)
        .reduce((sum, row) => sum + row.keyword_frequency, 0),
    })),
  };

  const midpoint = Math.floor(availableYears.length / 2);
  const earlyYears = new Set(availableYears.slice(0, midpoint));
  const lateYears = new Set(availableYears.slice(midpoint));
  const topicShifts = Object.entries(topicCounts)
    .map(([topic]) => ({
      topic,
      change:
        new Set(
          filteredDashboard.trends
            .filter((row) => lateYears.has(row.year) && row.topic === topic)
            .map((row) => row.paper_id)
        ).size -
        new Set(
          filteredDashboard.trends
            .filter((row) => earlyYears.has(row.year) && row.topic === topic)
            .map((row) => row.paper_id)
        ).size,
    }))
    .sort((left, right) => right.change - left.change);

  const singleTrackByPaper = new Map(
    filteredDashboard.tracksSingle.map((row) => [row.paper_id, row])
  );
  const trackTopicSections = TRACK_COLS.map((track) => {
    const counts: Record<string, Set<PaperId>> = {};
    filteredDashboard.trends.forEach((row) => {
      const trackRow = singleTrackByPaper.get(row.paper_id);
      if (!trackRow || Number(trackRow[toTrackField(track)] ?? 0) !== 1) {
        return;
      }
      (counts[row.topic] ??= new Set()).add(row.paper_id);
    });

    return {
      track,
      top_topics: Object.entries(counts)
        .map(([topic, ids]) => ({ topic, papers: ids.size }))
        .sort((left, right) => right.papers - left.papers)
        .slice(0, 8),
    };
  });

  return {
    mode: data.useMock ? "mock" : "live",
    approved_chart_types: [
      "adaptive_topic_momentum",
      "adaptive_emerging_topics",
      "adaptive_folder_topic_comparison",
      "adaptive_keyword_family_heatmap",
      "adaptive_track_topic_comparison",
    ],
    filters: {
      selected_years: years,
      selected_tracks: tracks,
      search_query: searchQuery,
      folder_ids: folderIds,
      all_folders_selected: folderIds.length === 0,
    },
    diagnostics: {
      canonical_topic_families_available: (filteredDashboard.topicFamilies?.length ?? 0) > 0,
      degraded_reason:
        (filteredDashboard.topicFamilies?.length ?? 0) > 0
          ? undefined
          : "canonical_topic_families_unavailable",
    },
    overview: {
      paper_count: paperCount,
      topic_count: topicCount,
      keyword_count: keywordCount,
      year_range: yearRange,
      available_years: availableYears,
      folder_count: new Set(
        filteredDashboard.trends.map((row) => row.folder_id).filter(Boolean)
      ).size,
    },
    canonical_topic_families: canonicalTopicFamilies,
    yearly_paper_trend: yearlyPaperTrend,
    track_totals: {
      single: buildTrackTotals(filteredDashboard.tracksSingle),
      multi: buildTrackTotals(filteredDashboard.tracksMulti),
    },
    top_topics_over_time: topTopicsOverTime,
    folder_topic_totals: folderTopicTotals,
    yearly_topic_totals: yearlyTopicTotals,
    keyword_heatmap: keywordHeatmap,
    topic_shifts: {
      emerging: topicShifts.filter((item) => item.change > 0).slice(0, 8),
      declining: topicShifts
        .filter((item) => item.change < 0)
        .slice(-8)
        .reverse(),
    },
    track_topic_sections: trackTopicSections,
    topic_by_track_totals: trackTopicSections.map((section) => ({
      track: section.track,
      topics: section.top_topics,
    })),
  };
}

export function getViableAdaptiveCharts(
  analytics: NormalizedAnalyticsPayload
): VisualizationChartKey[] {
  const viable: VisualizationChartKey[] = [];
  const nonEmptyYears = analytics.yearly_paper_trend.filter((row) => row.papers > 0);
  const topicFamilies = analytics.canonical_topic_families.filter((row) => row.paper_count > 0);
  const nonEmptyTracks = analytics.track_totals.single.filter((row) => row.value > 0);

  if (nonEmptyYears.length >= 2) viable.push("adaptive_year_volume");
  if (topicFamilies.length >= 2) viable.push("adaptive_topic_distribution");
  if (nonEmptyTracks.length >= 2) viable.push("adaptive_track_distribution");

  const topicYearValues = new Map<string, number[]>();
  for (const year of analytics.top_topics_over_time) {
    for (const topic of year.topics) {
      const values = topicYearValues.get(topic.topic) ?? [];
      values.push(topic.papers);
      topicYearValues.set(topic.topic, values);
    }
  }
  const hasChangingTopic = [...topicYearValues.values()].some(
    (values) => values.length >= 2 && new Set(values).size >= 2
  );
  if (hasChangingTopic) viable.push("adaptive_topic_momentum");
  if (analytics.topic_shifts.emerging.length + analytics.topic_shifts.declining.length >= 2) {
    viable.push("adaptive_emerging_topics");
  }
  if (analytics.folder_topic_totals.filter((row) => row.topics.length > 0).length >= 2) {
    viable.push("adaptive_folder_topic_comparison");
  }
  const hasHeatmapVariation = analytics.keyword_heatmap.rows.some(
    (row) =>
      row.totals_by_year.filter((value) => value > 0).length >= 2 &&
      new Set(row.totals_by_year).size >= 2
  );
  if (analytics.keyword_heatmap.years.length >= 2 && hasHeatmapVariation) {
    viable.push("adaptive_keyword_family_heatmap");
  }
  if (analytics.topic_by_track_totals.filter((row) => row.topics.length > 0).length >= 2) {
    viable.push("adaptive_track_topic_comparison");
  }
  return viable;
}

function buildDataAwareFallbackPlan(
  analytics: NormalizedAnalyticsPayload,
  viableChartKeys: VisualizationChartKey[]
): VisualizationPlan {
  const preferred: VisualizationChartKey[] = [
    "adaptive_year_volume",
    "adaptive_topic_distribution",
    "adaptive_track_distribution",
    "adaptive_topic_momentum",
    "adaptive_emerging_topics",
    "adaptive_folder_topic_comparison",
    "adaptive_keyword_family_heatmap",
    "adaptive_track_topic_comparison",
  ];
  const titles: Record<VisualizationChartKey, string> = {
    overview_metrics: "Overview metrics",
    papers_per_year: "Papers per year",
    track_single_breakdown: "Primary track distribution",
    track_multi_breakdown: "Multiple track distribution",
    topic_area: "Topic area",
    emerging_topics: "Emerging topics",
    declining_topics: "Declining topics",
    keyword_heatmap: "Keyword heatmap",
    track_year_stacked: "Tracks over time",
    track_cooccurrence: "Track co-occurrence",
    topics_per_track: "Topics by track",
    paper_table: "Paper table",
    adaptive_topic_momentum: "Topics with meaningful change over time",
    adaptive_emerging_topics: "Largest topic shifts",
    adaptive_folder_topic_comparison: "How folders differ by topic",
    adaptive_keyword_family_heatmap: "When keyword families appear",
    adaptive_track_topic_comparison: "How research tracks differ by topic",
    adaptive_year_volume: "Publication volume by year",
    adaptive_topic_distribution: "Most represented research topics",
    adaptive_track_distribution: "Research papers by primary track",
  };
  const charts = preferred
    .filter((key) => viableChartKeys.includes(key))
    .slice(0, 3)
    .map((chartKey) => ({
      chart_key: chartKey,
      title: titles[chartKey],
      reason: "Selected as a reliable view supported by the current filter snapshot.",
      config: chartKey.includes("topic") ? { top_n: 8 } : undefined,
    }));
  return {
    version: "v1",
    mode: analytics.mode,
    dashboard_title: "Charts for the current research scope",
    summary:
      charts.length > 0
        ? "A conservative chart set based only on dimensions with enough filtered data to interpret."
        : "The current filter snapshot does not contain enough varied data for a reliable chart.",
    sections: [{
      section_key: "adaptive",
      title: "Generated analysis",
      priority: 1,
      reason: "Charts are tied to the filter snapshot captured when Generate charts was selected.",
      charts,
    }],
  };
}

function buildVisualizationTool(viableChartKeys: VisualizationChartKey[]) {
  return {
    type: "function",
    function: {
      name: "build_adaptive_dashboard",
      description: "Build a concise adaptive research dashboard from chart types proven viable for the current filtered data.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["dashboard_title", "summary", "section_title", "section_reason", "charts"],
        properties: {
          dashboard_title: { type: "string" },
          summary: { type: "string" },
          section_title: { type: "string" },
          section_reason: { type: "string" },
          charts: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["chart_key", "title", "reason"],
              properties: {
                chart_key: { type: "string", enum: viableChartKeys },
                title: { type: "string" },
                reason: { type: "string" },
                config: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    top_n: { type: "integer", minimum: 3, maximum: 12 },
                    heat_n: { type: "integer", minimum: 4, maximum: 16 },
                    selected_tracks: { type: "array", items: { type: "string", enum: TRACK_COLS } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function toolPlanPayload(argumentsText: string | undefined, mode: "mock" | "live") {
  if (!argumentsText) return null;
  const parsed = parseJsonPayload(argumentsText) as Record<string, unknown>;
  return {
    version: "v1",
    mode,
    dashboard_title: parsed.dashboard_title,
    summary: parsed.summary,
    sections: [{
      section_key: "adaptive",
      title: parsed.section_title,
      priority: 1,
      reason: parsed.section_reason,
      charts: parsed.charts,
    }],
  };
}

function buildPlannerPrompt(
  analytics: NormalizedAnalyticsPayload,
  viableChartKeys: VisualizationChartKey[],
  context?: VisualizationPlannerRequest["context"]
): string {
  return `
You are an adaptive chart planning agent for a research analytics dashboard.
Return JSON only.

Your job is to select and sequence 1 to 5 high-value charts for the Adaptive tab.
The charts must come only from the approved chart catalog below.
Do not invent new chart types, layouts, or code.
Prefer a compact set of charts that together tell the strongest story in the current filtered corpus.
Use normalized canonical topics, not raw per-paper topic labels.
If multiple folders are active, prefer at least one comparison chart.
Prefer plan stability. If the corpus signature is broadly similar, keep the chart mix conservative instead of changing it just to be novel.
Assume KPI cards are already shown separately, so your chart picks should complement those KPI cards rather than repeat them.
Every chart reason must explain the decision value of the chart, not just restate what the axes show.
Treat this as research analysis, not decoration: select charts because the available data supports a useful question.
Do not select a chart whose required dimension is empty or too sparse to interpret.
Use concise, human-readable titles that state the analytical question or finding, never an internal chart key.
Order the charts as a narrative: corpus movement first, then comparisons, then structural detail.
Distinguish counts from frequencies and associations from causal claims.
When evidence is sparse or uneven, say so in the section reason instead of manufacturing a strong trend.
Use the workspace goal to prioritize relevant views, while still obeying the available data and approved catalog.

Core chart selection rubric:
- Include at least 1 time-based chart.
- Include at least 1 relationship/comparison chart.
- Include at least 1 distribution/structure chart.
- Avoid redundant charts that tell the same story from nearly the same data slice.
- Reject plans where two charts use nearly the same grouping and answer the same question.

Rubric guidance for the approved chart catalog:
- Reliable baselines: adaptive_year_volume, adaptive_topic_distribution, adaptive_track_distribution
- Time-based: adaptive_topic_momentum, adaptive_keyword_family_heatmap
- Relationship/comparison: adaptive_folder_topic_comparison, adaptive_track_topic_comparison
- Distribution/structure: adaptive_emerging_topics, adaptive_keyword_family_heatmap, adaptive_track_topic_comparison

The only chart keys proven viable for this exact filter snapshot are:
${viableChartKeys.map((key) => `- ${key}`).join("\n")}

Prefer reliable baseline charts when they answer the question clearly. Use advanced cross-topic charts only
when they add information beyond publication, topic, or track distributions. Never choose an advanced chart
just because it sounds more sophisticated.

Allowed config fields:
- top_n
- heat_n
- selected_tracks

Call build_adaptive_dashboard exactly once. Its arguments must contain a concise dashboard title,
a useful summary, a section title and reason, and 1 to 5 non-redundant charts selected only from
the viable keys above. Fewer strong charts are better than padding the dashboard with weak charts.

Workspace context:
${JSON.stringify(context ?? {}, null, 2)}

Normalized analytics payload:
${JSON.stringify(analytics, null, 2)}
`.trim();
}

export async function planVisualization(
  request: VisualizationPlannerRequest = {},
  ownerUserId?: string | null
): Promise<{
  plan: VisualizationPlan;
  analytics: NormalizedAnalyticsPayload;
  source: "agent" | "fallback";
}> {
  const analytics = await buildNormalizedAnalyticsPayload(request, ownerUserId);
  const includeFolderComparison =
    analytics.filters.folder_ids.length > 1 ||
    (analytics.filters.all_folders_selected && analytics.overview.folder_count > 1);
  const viableChartKeys = getViableAdaptiveCharts(analytics);
  const dataAwareFallback = buildDataAwareFallbackPlan(analytics, viableChartKeys);

  if (viableChartKeys.length === 0) {
    return { plan: dataAwareFallback, analytics, source: "fallback" };
  }

  try {
    const response = await createChatCompletionResult(
      [
        {
          role: "system",
          content:
            "You are Papertrend's senior research-visualization planner. Select truthful, decision-useful charts from the approved tool catalog and call the required tool exactly once.",
        },
        {
          role: "user",
          content: buildPlannerPrompt(analytics, viableChartKeys, request.context),
        },
      ],
      0,
      undefined,
      "VISUALIZATION_PLANNING",
      {
        maxTokens: 1400,
        tools: [buildVisualizationTool(viableChartKeys)],
        toolChoice: { type: "function", function: { name: "build_adaptive_dashboard" } },
        parallelToolCalls: false,
      }
    );

    if (!response) {
      return { plan: dataAwareFallback, analytics, source: "fallback" };
    }

    const toolCall = response.toolCalls.find(
      (call) => call.function?.name === "build_adaptive_dashboard"
    );
    const rawPlan = toolPlanPayload(toolCall?.function?.arguments, analytics.mode);
    return {
      plan: sanitizeVisualizationPlan(
        rawPlan,
        analytics.mode,
        analytics.filters.selected_tracks,
        includeFolderComparison,
        viableChartKeys
      ),
      analytics,
      source: "agent",
    };
  } catch {
    return { plan: dataAwareFallback, analytics, source: "fallback" };
  }
}

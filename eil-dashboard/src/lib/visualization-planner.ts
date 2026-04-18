import { TRACK_COLS, type TrackKey } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import { createChatCompletion } from "@/lib/openai";
import {
  createDefaultVisualizationPlan,
  sanitizeVisualizationPlan,
} from "@/lib/visualization-plan";
import type { DashboardData, PaperId, TrackRow } from "@/types/database";
import type {
  NormalizedAnalyticsPayload,
  VisualizationPlan,
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
  const years =
    request.selectedYears && request.selectedYears.length > 0
      ? request.selectedYears
      : [...new Set(data.trends.map((row) => row.year))].sort();
  const tracks =
    request.selectedTracks && request.selectedTracks.length > 0
      ? request.selectedTracks
      : ([...TRACK_COLS] as TrackKey[]);
  const searchQuery = request.searchQuery?.trim() ?? "";

  const filtered = filterDashboardData(data, years, tracks, searchQuery);
  const filteredDashboard: DashboardData = {
    ...filtered,
    useMock: data.useMock,
    diagnostics: data.diagnostics,
  };

  const paperCount = new Set([
    ...filteredDashboard.trends.map((row) => row.paper_id),
    ...filteredDashboard.tracksSingle.map((row) => row.paper_id),
    ...filteredDashboard.tracksMulti.map((row) => row.paper_id),
  ]).size;
  const topicCount = new Set(filteredDashboard.trends.map((row) => row.topic)).size;
  const keywordCount = new Set(filteredDashboard.trends.map((row) => row.keyword)).size;
  const availableYears = [
    ...new Set([
      ...filteredDashboard.trends.map((row) => row.year),
      ...filteredDashboard.tracksSingle.map((row) => row.year),
      ...filteredDashboard.tracksMulti.map((row) => row.year),
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

function buildPlannerPrompt(
  analytics: NormalizedAnalyticsPayload,
  context?: VisualizationPlannerRequest["context"]
): string {
  return `
You are an adaptive chart planning agent for a research analytics dashboard.
Return JSON only.

Your job is to pick 4 to 5 charts for the Adaptive tab.
The charts must come only from the approved chart catalog below.
Do not invent new chart types, layouts, or code.
Prefer a compact set of charts that together tell the strongest story in the current filtered corpus.
Use normalized canonical topics, not raw per-paper topic labels.
If multiple folders are active, prefer at least one comparison chart.
Prefer plan stability. If the corpus signature is broadly similar, keep the chart mix conservative instead of changing it just to be novel.
Assume KPI cards are already shown separately, so your chart picks should complement those KPI cards rather than repeat them.

Allowed chart_key values:
- adaptive_topic_momentum
- adaptive_emerging_topics
- adaptive_folder_topic_comparison
- adaptive_keyword_family_heatmap
- adaptive_track_topic_comparison

Allowed config fields:
- top_n
- heat_n
- selected_tracks

Return this exact top-level JSON shape:
{
  "version": "v1",
  "mode": "mock|live",
  "dashboard_title": "string",
  "summary": "string",
  "sections": [
    {
      "section_key": "adaptive",
      "title": "Adaptive",
      "priority": 1,
      "reason": "string",
      "charts": [
        {
          "chart_key": "one of the allowed chart keys",
          "title": "string",
          "reason": "string",
          "config": {
            "top_n": 8,
            "heat_n": 12,
            "selected_tracks": ["EL","ELI","LAE","Other"]
          }
        }
      ]
    }
  ]
}

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
  const fallback = createDefaultVisualizationPlan(
    analytics.mode,
    analytics.filters.selected_tracks,
    includeFolderComparison
  );

  try {
    const response = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You are a strict adaptive visualization planning agent. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: buildPlannerPrompt(analytics, request.context),
        },
      ],
      0,
      undefined,
      "VISUALIZATION_PLANNING"
    );

    if (!response) {
      return { plan: fallback, analytics, source: "fallback" };
    }

    const rawPlan = parseJsonPayload(response);
    return {
      plan: sanitizeVisualizationPlan(
        rawPlan,
        analytics.mode,
        analytics.filters.selected_tracks,
        includeFolderComparison
      ),
      analytics,
      source: "agent",
    };
  } catch {
    return { plan: fallback, analytics, source: "fallback" };
  }
}

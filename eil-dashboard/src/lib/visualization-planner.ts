import { TRACK_COLS, type TrackKey } from "@/lib/constants";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import { createChatCompletion } from "@/lib/openai";
import {
  createDefaultVisualizationPlan,
  sanitizeVisualizationPlan,
} from "@/lib/visualization-plan";
import type { DashboardData, TrackRow, TrendRow } from "@/types/database";
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

export async function buildNormalizedAnalyticsPayload(
  request: VisualizationPlannerRequest = {},
  ownerUserId?: string | null
): Promise<NormalizedAnalyticsPayload> {
  const data = await loadDashboardDataServer(
    ownerUserId,
    request.folderId && request.folderId !== "all" ? request.folderId : null
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
  };

  const paperCount = new Set(filteredDashboard.trends.map((row) => row.paper_id)).size;
  const topicCount = new Set(filteredDashboard.trends.map((row) => row.topic)).size;
  const keywordCount = new Set(filteredDashboard.trends.map((row) => row.keyword)).size;
  const availableYears = [...new Set(filteredDashboard.trends.map((row) => row.year))].sort();
  const yearRange =
    availableYears.length > 0
      ? `${availableYears[0]} to ${availableYears[availableYears.length - 1]}`
      : "No data";

  const yearlyPaperTrend = Object.entries(
    filteredDashboard.trends.reduce<Record<string, Set<number>>>((accumulator, row) => {
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

  const topicCounts = filteredDashboard.trends.reduce<
    Record<string, { papers: Set<number>; yearly: Record<string, Set<number>> }>
  >((accumulator, row) => {
    const entry = (accumulator[row.topic] ??= { papers: new Set(), yearly: {} });
    entry.papers.add(row.paper_id);
    (entry.yearly[row.year] ??= new Set()).add(row.paper_id);
    return accumulator;
  }, {});

  const topTopics = Object.entries(topicCounts)
    .sort((left, right) => right[1].papers.size - left[1].papers.size)
    .slice(0, 8)
    .map(([topic]) => topic);

  const topTopicsOverTime = availableYears.map((year) => ({
    year,
    topics: topTopics
      .map((topic) => ({
        topic,
        papers: topicCounts[topic]?.yearly[year]?.size ?? 0,
      }))
      .filter((entry) => entry.papers > 0),
  }));

  const keywordTotals = filteredDashboard.trends.reduce<Record<string, number>>(
    (accumulator, row) => {
      accumulator[row.keyword] =
        (accumulator[row.keyword] ?? 0) + row.keyword_frequency;
      return accumulator;
    },
    {}
  );

  const topKeywords = Object.entries(keywordTotals)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 15)
    .map(([keyword]) => keyword);

  const keywordHeatmap = {
    years: availableYears,
    rows: topKeywords.map((keyword) => ({
      keyword,
      totals_by_year: availableYears.map((year) =>
        filteredDashboard.trends
          .filter((row) => row.year === year && row.keyword === keyword)
          .reduce((sum, row) => sum + row.keyword_frequency, 0)
      ),
      total_frequency: keywordTotals[keyword] ?? 0,
    })),
  };

  const midpoint = Math.floor(availableYears.length / 2);
  const earlyYears = new Set(availableYears.slice(0, midpoint));
  const lateYears = new Set(availableYears.slice(midpoint));
  const topicShifts = Object.entries(topicCounts)
    .map(([topic, entry]) => ({
      topic,
      change:
        Object.entries(entry.yearly).reduce(
          (sum, [year, ids]) => sum + (lateYears.has(year) ? ids.size : 0),
          0
        ) -
        Object.entries(entry.yearly).reduce(
          (sum, [year, ids]) => sum + (earlyYears.has(year) ? ids.size : 0),
          0
        ),
    }))
    .sort((left, right) => right.change - left.change);

  const singleTrackByPaper = new Map(
    filteredDashboard.tracksSingle.map((row) => [row.paper_id, row])
  );
  const trackTopicSections = TRACK_COLS.map((track) => {
    const counts: Record<string, Set<number>> = {};
    filteredDashboard.trends.forEach((row) => {
      const trackRow = singleTrackByPaper.get(row.paper_id);
      if (!trackRow || trackRow[toTrackField(track)] !== 1) {
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
      "overview_metrics",
      "papers_per_year",
      "track_single_breakdown",
      "track_multi_breakdown",
      "topic_area",
      "emerging_topics",
      "declining_topics",
      "keyword_heatmap",
      "track_year_stacked",
      "track_cooccurrence",
      "topics_per_track",
      "paper_table",
    ],
    filters: {
      selected_years: years,
      selected_tracks: tracks,
      search_query: searchQuery,
    },
    overview: {
      paper_count: paperCount,
      topic_count: topicCount,
      keyword_count: keywordCount,
      year_range: yearRange,
      available_years: availableYears,
    },
    yearly_paper_trend: yearlyPaperTrend,
    track_totals: {
      single: buildTrackTotals(filteredDashboard.tracksSingle),
      multi: buildTrackTotals(filteredDashboard.tracksMulti),
    },
    top_topics_over_time: topTopicsOverTime,
    keyword_heatmap: keywordHeatmap,
    topic_shifts: {
      emerging: topicShifts.filter((item) => item.change > 0).slice(0, 8),
      declining: topicShifts
        .filter((item) => item.change < 0)
        .slice(-8)
        .reverse(),
    },
    track_topic_sections: trackTopicSections,
  };
}

function buildPlannerPrompt(
  analytics: NormalizedAnalyticsPayload,
  context?: VisualizationPlannerRequest["context"]
): string {
  return `
You are a visualization planning agent for a research analytics dashboard.
Return JSON only.

Choose from the approved chart catalog only.
Do not generate code, JSX, SQL, or any chart types outside the approved chart list.
Prefer plans that are readable, varied, and explainable for the current dataset.
Keep all five sections if they are useful, but you may change their order and emphasis.
Use the dataset mode and analytics summary to decide which sections deserve priority.

Allowed section_key values:
- overview
- trend_analysis
- track_analysis
- keyword_explorer
- paper_explorer

Allowed chart_key values:
- overview_metrics
- papers_per_year
- track_single_breakdown
- track_multi_breakdown
- topic_area
- emerging_topics
- declining_topics
- keyword_heatmap
- track_year_stacked
- track_cooccurrence
- topics_per_track
- paper_table

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
      "section_key": "overview|trend_analysis|track_analysis|keyword_explorer|paper_explorer",
      "title": "string",
      "priority": 1,
      "reason": "string",
      "charts": [
        {
          "chart_key": "one of the approved chart keys",
          "title": "string",
          "reason": "string",
          "config": {
            "top_n": 10,
            "heat_n": 15,
            "selected_tracks": ["EL","ELI","LAE","Other"]
          }
        }
      ]
    }
  ]
}

Workspace context:
${JSON.stringify(context ?? {}, null, 2)}

Analytics payload:
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
  const fallback = createDefaultVisualizationPlan(
    analytics.mode,
    analytics.filters.selected_tracks
  );

  try {
    const response = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You are a strict visualization planning agent. Respond with valid JSON only.",
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
        analytics.filters.selected_tracks
      ),
      analytics,
      source: "agent",
    };
  } catch {
    return { plan: fallback, analytics, source: "fallback" };
  }
}

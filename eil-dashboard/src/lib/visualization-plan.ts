import { TRACK_COLS, type TrackKey } from "@/lib/constants";
import {
  VISUALIZATION_CHART_KEYS,
  VISUALIZATION_SECTION_KEYS,
  type VisualizationChartConfig,
  type VisualizationChartKey,
  type VisualizationPlan,
  type VisualizationPlanChart,
  type VisualizationPlanSection,
  type VisualizationSectionKey,
} from "@/types/visualization";

const DEFAULT_TRACKS = [...TRACK_COLS] as TrackKey[];

const CHART_SECTION_MAP: Record<VisualizationChartKey, VisualizationSectionKey> = {
  overview_metrics: "overview",
  papers_per_year: "overview",
  track_single_breakdown: "overview",
  track_multi_breakdown: "overview",
  topic_area: "trend_analysis",
  emerging_topics: "trend_analysis",
  declining_topics: "trend_analysis",
  keyword_heatmap: "keyword_explorer",
  track_year_stacked: "track_analysis",
  track_cooccurrence: "track_analysis",
  topics_per_track: "track_analysis",
  paper_table: "paper_explorer",
};

const SECTION_TITLES: Record<VisualizationSectionKey, string> = {
  overview: "Overview",
  trend_analysis: "Trend Analysis",
  track_analysis: "Track Analysis",
  keyword_explorer: "Keyword Explorer",
  paper_explorer: "Paper Explorer",
};

const DEFAULT_CHARTS: Record<VisualizationSectionKey, VisualizationPlanChart[]> = {
  overview: [
    {
      chart_key: "overview_metrics",
      title: "Coverage metrics",
      reason: "Quickly summarizes paper, topic, keyword, and year coverage.",
    },
    {
      chart_key: "papers_per_year",
      title: "Papers per year",
      reason: "Shows how publication volume changes across the selected years.",
    },
    {
      chart_key: "track_single_breakdown",
      title: "Single-label track mix",
      reason: "Highlights how papers are distributed across the main tracks.",
    },
    {
      chart_key: "track_multi_breakdown",
      title: "Multi-label track overlap",
      reason: "Shows how track overlap differs from single-label assignment.",
    },
  ],
  trend_analysis: [
    {
      chart_key: "topic_area",
      title: "Topic trends over time",
      reason: "Useful for comparing how the strongest topics change by year.",
      config: { top_n: 10 },
    },
    {
      chart_key: "emerging_topics",
      title: "Emerging topics",
      reason: "Surfaces topics that are gaining momentum across the current time span.",
      config: { top_n: 8 },
    },
    {
      chart_key: "declining_topics",
      title: "Declining topics",
      reason: "Balances the trend view by showing topics that are becoming less prominent.",
      config: { top_n: 8 },
    },
  ],
  track_analysis: [
    {
      chart_key: "track_year_stacked",
      title: "Track count by year",
      reason: "Shows how each track contributes to yearly paper volume.",
      config: { selected_tracks: DEFAULT_TRACKS },
    },
    {
      chart_key: "track_cooccurrence",
      title: "Track co-occurrence",
      reason: "Highlights how often tracks appear together on the same paper.",
    },
    {
      chart_key: "topics_per_track",
      title: "Top topics per track",
      reason: "Connects each track to the most common topics within it.",
      config: { top_n: 8, selected_tracks: DEFAULT_TRACKS },
    },
  ],
  keyword_explorer: [
    {
      chart_key: "keyword_heatmap",
      title: "Keyword heatmap",
      reason: "Shows high-frequency keywords across the selected years.",
      config: { heat_n: 15 },
    },
  ],
  paper_explorer: [
    {
      chart_key: "paper_table",
      title: "Paper table",
      reason: "Keeps paper-level inspection available alongside the analytical views.",
    },
  ],
};

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeConfig(
  chartKey: VisualizationChartKey,
  config: unknown,
  defaultTracks: TrackKey[]
): VisualizationChartConfig | undefined {
  const input = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const next: VisualizationChartConfig = {};

  if ("top_n" in input) {
    next.top_n = clampInteger(input.top_n, 10, 3, 25);
  }
  if ("heat_n" in input) {
    next.heat_n = clampInteger(input.heat_n, 15, 5, 40);
  }
  if (Array.isArray(input.selected_tracks)) {
    const tracks = input.selected_tracks.filter(
      (track): track is TrackKey =>
        typeof track === "string" && TRACK_COLS.includes(track as TrackKey)
    );
    if (tracks.length > 0) {
      next.selected_tracks = tracks;
    }
  }

  if (
    (chartKey === "track_year_stacked" || chartKey === "topics_per_track") &&
    !next.selected_tracks
  ) {
    next.selected_tracks = defaultTracks;
  }

  if (chartKey === "keyword_heatmap" && !next.heat_n) {
    next.heat_n = 15;
  }

  if (
    (chartKey === "topic_area" ||
      chartKey === "emerging_topics" ||
      chartKey === "declining_topics" ||
      chartKey === "topics_per_track") &&
    !next.top_n
  ) {
    next.top_n = chartKey === "topic_area" ? 10 : 8;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function createDefaultVisualizationPlan(
  mode: "mock" | "live",
  selectedTracks: TrackKey[] = DEFAULT_TRACKS
): VisualizationPlan {
  return {
    version: "v1",
    mode,
    dashboard_title:
      mode === "mock" ? "Preview analytics workspace" : "Adaptive analytics workspace",
    summary:
      mode === "mock"
        ? "Using preview data with the default chart plan while the live analysis pipeline is unavailable."
        : "Using the default chart plan across overview, trend, track, keyword, and paper exploration.",
    sections: VISUALIZATION_SECTION_KEYS.map((sectionKey, index) => ({
      section_key: sectionKey,
      title: SECTION_TITLES[sectionKey],
      priority: index + 1,
      reason: `Default section for ${SECTION_TITLES[sectionKey].toLowerCase()}.`,
      charts: DEFAULT_CHARTS[sectionKey].map((chart) => ({
        ...chart,
        config: sanitizeConfig(chart.chart_key, chart.config, selectedTracks),
      })),
    })),
  };
}

export function sanitizeVisualizationPlan(
  rawPlan: unknown,
  fallbackMode: "mock" | "live",
  selectedTracks: TrackKey[] = DEFAULT_TRACKS
): VisualizationPlan {
  const fallback = createDefaultVisualizationPlan(fallbackMode, selectedTracks);
  if (!rawPlan || typeof rawPlan !== "object") {
    return fallback;
  }

  const plan = rawPlan as Record<string, unknown>;
  const mode = plan.mode === "live" ? "live" : fallbackMode;
  const sectionsInput = Array.isArray(plan.sections) ? plan.sections : [];

  const sections = sectionsInput
    .map((section, index): VisualizationPlanSection | null => {
      if (!section || typeof section !== "object") {
        return null;
      }

      const value = section as Record<string, unknown>;
      const sectionKey = value.section_key;
      if (
        typeof sectionKey !== "string" ||
        !VISUALIZATION_SECTION_KEYS.includes(sectionKey as VisualizationSectionKey)
      ) {
        return null;
      }

      const chartsInput = Array.isArray(value.charts) ? value.charts : [];
      const charts = chartsInput
        .map((chart): VisualizationPlanChart | null => {
          if (!chart || typeof chart !== "object") {
            return null;
          }

          const chartValue = chart as Record<string, unknown>;
          const chartKey = chartValue.chart_key;
          if (
            typeof chartKey !== "string" ||
            !VISUALIZATION_CHART_KEYS.includes(chartKey as VisualizationChartKey)
          ) {
            return null;
          }

          if (CHART_SECTION_MAP[chartKey as VisualizationChartKey] !== sectionKey) {
            return null;
          }

          return {
            chart_key: chartKey as VisualizationChartKey,
            title:
              typeof chartValue.title === "string" && chartValue.title.trim()
                ? chartValue.title.trim()
                : DEFAULT_CHARTS[sectionKey][0]?.title ?? chartKey,
            reason:
              typeof chartValue.reason === "string" && chartValue.reason.trim()
                ? chartValue.reason.trim()
                : "Selected by the visualization planner.",
            config: sanitizeConfig(
              chartKey as VisualizationChartKey,
              chartValue.config,
              selectedTracks
            ),
          };
        })
        .filter((chart): chart is VisualizationPlanChart => Boolean(chart));

      if (charts.length === 0) {
        return null;
      }

      return {
        section_key: sectionKey as VisualizationSectionKey,
        title:
          typeof value.title === "string" && value.title.trim()
            ? value.title.trim()
            : SECTION_TITLES[sectionKey as VisualizationSectionKey],
        priority: clampInteger(value.priority, index + 1, 1, 99),
        reason:
          typeof value.reason === "string" && value.reason.trim()
            ? value.reason.trim()
            : `Planner-selected section for ${SECTION_TITLES[
                sectionKey as VisualizationSectionKey
              ].toLowerCase()}.`,
        charts,
      };
    })
    .filter((section): section is VisualizationPlanSection => Boolean(section))
    .sort((left, right) => left.priority - right.priority);

  if (sections.length === 0) {
    return fallback;
  }

  return {
    version: "v1",
    mode,
    dashboard_title:
      typeof plan.dashboard_title === "string" && plan.dashboard_title.trim()
        ? plan.dashboard_title.trim()
        : fallback.dashboard_title,
    summary:
      typeof plan.summary === "string" && plan.summary.trim()
        ? plan.summary.trim()
        : fallback.summary,
    sections,
  };
}

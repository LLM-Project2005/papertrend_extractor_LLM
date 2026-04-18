import { TRACK_COLS, type TrackKey } from "@/lib/constants";
import {
  VISUALIZATION_CHART_KEYS,
  type VisualizationChartConfig,
  type VisualizationChartKey,
  type VisualizationPlan,
  type VisualizationPlanChart,
  type VisualizationPlanSection,
} from "@/types/visualization";

const DEFAULT_TRACKS = [...TRACK_COLS] as TrackKey[];

const ADAPTIVE_CHART_KEYS: VisualizationChartKey[] = [
  "adaptive_topic_momentum",
  "adaptive_emerging_topics",
  "adaptive_folder_topic_comparison",
  "adaptive_keyword_family_heatmap",
  "adaptive_track_topic_comparison",
];

type AdaptiveRubricCategory = "time" | "comparison" | "structure";

const ADAPTIVE_CHART_RUBRIC_CATEGORIES: Record<
  VisualizationChartKey,
  AdaptiveRubricCategory[]
> = {
  overview_metrics: [],
  papers_per_year: [],
  track_single_breakdown: [],
  track_multi_breakdown: [],
  topic_area: [],
  emerging_topics: [],
  declining_topics: [],
  keyword_heatmap: [],
  track_year_stacked: [],
  track_cooccurrence: [],
  topics_per_track: [],
  paper_table: [],
  adaptive_topic_momentum: ["time"],
  adaptive_emerging_topics: ["structure"],
  adaptive_folder_topic_comparison: ["comparison"],
  adaptive_keyword_family_heatmap: ["time", "structure"],
  adaptive_track_topic_comparison: ["comparison", "structure"],
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
    next.top_n = clampInteger(input.top_n, 8, 3, 20);
  }
  if ("heat_n" in input) {
    next.heat_n = clampInteger(input.heat_n, 12, 4, 24);
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

  if (chartKey === "adaptive_track_topic_comparison" && !next.selected_tracks) {
    next.selected_tracks = defaultTracks;
  }
  if (
    [
      "adaptive_topic_momentum",
      "adaptive_emerging_topics",
      "adaptive_folder_topic_comparison",
      "adaptive_track_topic_comparison",
    ].includes(chartKey)
    && !next.top_n
  ) {
    next.top_n = chartKey === "adaptive_topic_momentum" ? 6 : 8;
  }
  if (chartKey === "adaptive_keyword_family_heatmap" && !next.heat_n) {
    next.heat_n = 12;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function getAdaptiveRubricCategories(chartKey: VisualizationChartKey) {
  return ADAPTIVE_CHART_RUBRIC_CATEGORIES[chartKey] ?? [];
}

function dedupeChartsByKey(charts: VisualizationPlanChart[]) {
  const seen = new Set<VisualizationChartKey>();
  return charts.filter((chart) => {
    if (seen.has(chart.chart_key)) {
      return false;
    }
    seen.add(chart.chart_key);
    return true;
  });
}

function chartSatisfiesAnyCategory(
  chart: VisualizationPlanChart,
  categories: AdaptiveRubricCategory[]
) {
  const chartCategories = getAdaptiveRubricCategories(chart.chart_key);
  return categories.some((category) => chartCategories.includes(category));
}

function enforceAdaptiveCoreRubric(
  charts: VisualizationPlanChart[],
  fallbackCharts: VisualizationPlanChart[]
) {
  const rubricOrder: AdaptiveRubricCategory[] = ["time", "comparison", "structure"];
  const nextCharts = dedupeChartsByKey(charts);

  for (const category of rubricOrder) {
    if (nextCharts.some((chart) => getAdaptiveRubricCategories(chart.chart_key).includes(category))) {
      continue;
    }

    const fallbackMatch = fallbackCharts.find(
      (chart) =>
        !nextCharts.some((entry) => entry.chart_key === chart.chart_key) &&
        getAdaptiveRubricCategories(chart.chart_key).includes(category)
    );

    if (fallbackMatch) {
      nextCharts.push(fallbackMatch);
    }
  }

  const preferredOrder = fallbackCharts.map((chart) => chart.chart_key);
  return dedupeChartsByKey(nextCharts)
    .sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left.chart_key);
      const rightIndex = preferredOrder.indexOf(right.chart_key);
      const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
      return normalizedLeft - normalizedRight;
    })
    .slice(0, 5);
}

function buildAdaptiveSection(
  mode: "mock" | "live",
  selectedTracks: TrackKey[] = DEFAULT_TRACKS,
  includeFolderComparison = false
): VisualizationPlanSection {
  const charts: VisualizationPlanChart[] = [
    {
      chart_key: "adaptive_topic_momentum",
      title: "Canonical topic momentum",
      reason: "Shows which normalized topics actually carry the corpus over time.",
      config: { top_n: 6 },
    },
    {
      chart_key: "adaptive_emerging_topics",
      title: "Emerging and declining canonical topics",
      reason: "Makes directional change easier to read than a flat topic table.",
      config: { top_n: 8 },
    },
    {
      chart_key: "adaptive_keyword_family_heatmap",
      title: "Keyword family heatmap",
      reason: "Shows where the strongest normalized topic families actually concentrate over time.",
      config: { heat_n: 10 },
    },
    {
      chart_key: "adaptive_track_topic_comparison",
      title: "Track-to-topic comparison",
      reason: "Connects the strongest normalized topics back to the current track mix.",
      config: { top_n: 6, selected_tracks: selectedTracks },
    },
  ];

  if (includeFolderComparison) {
    charts.push({
      chart_key: "adaptive_folder_topic_comparison",
      title: "Cross-folder topic comparison",
      reason: "Highlights how the selected folders diverge or align on normalized topic families.",
      config: { top_n: 6 },
    });
  }

  return {
    section_key: "adaptive",
    title: mode === "mock" ? "Preview adaptive charts" : "Adaptive charts",
    priority: 1,
    reason:
      mode === "mock"
        ? "Preview mode keeps a compact adaptive chart set so the layout stays useful before live data lands."
        : "Adaptive charts focus on the strongest corpus signals after topic normalization.",
    charts: charts.map((chart) => ({
      ...chart,
      config: sanitizeConfig(chart.chart_key, chart.config, selectedTracks),
    })),
  };
}

export function createDefaultVisualizationPlan(
  mode: "mock" | "live",
  selectedTracks: TrackKey[] = DEFAULT_TRACKS,
  includeFolderComparison = false
): VisualizationPlan {
  return {
    version: "v1",
    mode,
    dashboard_title:
      mode === "mock" ? "Preview adaptive workspace" : "Adaptive analytics workspace",
    summary:
      mode === "mock"
        ? "Preview data is active, so the adaptive tab is using a safe default chart mix."
        : "The adaptive tab is focusing on normalized corpus topics, their movement over time, and how they interact with track structure.",
    sections: [buildAdaptiveSection(mode, selectedTracks, includeFolderComparison)],
  };
}

export function sanitizeVisualizationPlan(
  rawPlan: unknown,
  fallbackMode: "mock" | "live",
  selectedTracks: TrackKey[] = DEFAULT_TRACKS,
  includeFolderComparison = false
): VisualizationPlan {
  const fallback = createDefaultVisualizationPlan(
    fallbackMode,
    selectedTracks,
    includeFolderComparison
  );
  const fallbackAdaptiveSection = fallback.sections.find(
    (section) => section.section_key === "adaptive"
  );
  const fallbackCharts = fallbackAdaptiveSection?.charts ?? [];
  if (!rawPlan || typeof rawPlan !== "object") {
    return fallback;
  }

  const plan = rawPlan as Record<string, unknown>;
  const sectionsInput = Array.isArray(plan.sections) ? plan.sections : [];
  const chartsInput =
    sectionsInput.find(
      (section) =>
        section &&
        typeof section === "object" &&
        (section as Record<string, unknown>).section_key === "adaptive"
    ) ??
    (plan.adaptive ?? null);

  const rawCharts = Array.isArray((chartsInput as Record<string, unknown> | null)?.charts)
    ? ((chartsInput as Record<string, unknown>).charts as unknown[])
    : Array.isArray(plan.charts)
      ? (plan.charts as unknown[])
      : [];

  const charts = rawCharts
    .map((chart): VisualizationPlanChart | null => {
      if (!chart || typeof chart !== "object") {
        return null;
      }

      const value = chart as Record<string, unknown>;
      const chartKey = value.chart_key;
      if (
        typeof chartKey !== "string" ||
        !VISUALIZATION_CHART_KEYS.includes(chartKey as VisualizationChartKey) ||
        !ADAPTIVE_CHART_KEYS.includes(chartKey as VisualizationChartKey)
      ) {
        return null;
      }

      return {
        chart_key: chartKey as VisualizationChartKey,
        title:
          typeof value.title === "string" && value.title.trim()
            ? value.title.trim()
            : chartKey,
        reason:
          typeof value.reason === "string" && value.reason.trim()
            ? value.reason.trim()
            : "Selected by the adaptive visualization planner.",
        config: sanitizeConfig(
          chartKey as VisualizationChartKey,
          value.config,
          selectedTracks
        ),
      };
    })
    .filter((chart): chart is VisualizationPlanChart => Boolean(chart))
    .slice(0, 5);

  const rubricSafeCharts = enforceAdaptiveCoreRubric(charts, fallbackCharts);

  if (rubricSafeCharts.length === 0) {
    return fallback;
  }

  return {
    version: "v1",
    mode: plan.mode === "mock" ? "mock" : fallbackMode,
    dashboard_title:
      typeof plan.dashboard_title === "string" && plan.dashboard_title.trim()
        ? plan.dashboard_title.trim()
        : fallback.dashboard_title,
    summary:
      typeof plan.summary === "string" && plan.summary.trim()
        ? plan.summary.trim()
        : fallback.summary,
    sections: [
      {
        section_key: "adaptive",
        title:
          typeof (chartsInput as Record<string, unknown> | null)?.title === "string" &&
          String((chartsInput as Record<string, unknown>).title).trim()
            ? String((chartsInput as Record<string, unknown>).title).trim()
            : "Adaptive charts",
        priority: 1,
        reason:
          typeof (chartsInput as Record<string, unknown> | null)?.reason === "string" &&
          String((chartsInput as Record<string, unknown>).reason).trim()
            ? String((chartsInput as Record<string, unknown>).reason).trim()
            : "Adaptive charts selected from the deterministic chart catalog.",
        charts: rubricSafeCharts,
      },
    ],
  };
}

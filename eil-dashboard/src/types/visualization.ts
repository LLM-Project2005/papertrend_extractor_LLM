import type { TrackKey } from "@/lib/constants";

/*
 * Chart keys the fixed dashboard tabs use to order and configure their own
 * charts. The Adaptive tab's model-planned chart types, and the plan shapes
 * the old planner produced, are gone: that tab now draws computed insights
 * (src/lib/insights, docs/30).
 */
export const VISUALIZATION_CHART_KEYS = [
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
] as const;

export type VisualizationChartKey = (typeof VISUALIZATION_CHART_KEYS)[number];

export interface VisualizationChartConfig {
  top_n?: number;
  heat_n?: number;
  selected_tracks?: TrackKey[];
}

export interface VisualizationPlanChart {
  chart_key: VisualizationChartKey;
  title: string;
  reason: string;
  config?: VisualizationChartConfig;
}

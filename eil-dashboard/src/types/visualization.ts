import type { TrackKey } from "@/lib/constants";

export const VISUALIZATION_SECTION_KEYS = [
  "overview",
  "trend_analysis",
  "track_analysis",
  "keyword_explorer",
  "paper_explorer",
  "adaptive",
] as const;

export type VisualizationSectionKey =
  (typeof VISUALIZATION_SECTION_KEYS)[number];

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
  "adaptive_topic_momentum",
  "adaptive_emerging_topics",
  "adaptive_folder_topic_comparison",
  "adaptive_keyword_family_heatmap",
  "adaptive_track_topic_comparison",
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

export interface VisualizationPlanSection {
  section_key: VisualizationSectionKey;
  title: string;
  priority: number;
  reason: string;
  charts: VisualizationPlanChart[];
}

export interface VisualizationPlan {
  version: "v1";
  mode: "mock" | "live";
  dashboard_title: string;
  summary: string;
  sections: VisualizationPlanSection[];
}

export interface VisualizationPlannerRequest {
  folderIds?: string[];
  projectId?: string | "all";
  selectedYears?: string[];
  selectedTracks?: TrackKey[];
  searchQuery?: string;
  context?: {
    workspaceName?: string;
    domain?: string;
    goal?: string;
  };
}

export interface NormalizedAnalyticsPayload {
  mode: "mock" | "live";
  approved_chart_types: VisualizationChartKey[];
  filters: {
    selected_years: string[];
    selected_tracks: TrackKey[];
    search_query: string;
    folder_ids: string[];
    all_folders_selected: boolean;
  };
  overview: {
    paper_count: number;
    topic_count: number;
    keyword_count: number;
    year_range: string;
    available_years: string[];
    folder_count: number;
  };
  canonical_topic_families: Array<{
    canonical_topic: string;
    aliases: string[];
    representative_keywords: string[];
    paper_count: number;
    total_keyword_frequency: number;
  }>;
  yearly_paper_trend: Array<{
    year: string;
    papers: number;
  }>;
  track_totals: {
    single: Array<{ track: TrackKey; value: number }>;
    multi: Array<{ track: TrackKey; value: number }>;
  };
  top_topics_over_time: Array<{
    year: string;
    topics: Array<{ topic: string; papers: number }>;
  }>;
  folder_topic_totals: Array<{
    folder_id: string;
    total_papers: number;
    topics: Array<{ topic: string; papers: number; frequency: number }>;
  }>;
  yearly_topic_totals: Array<{
    year: string;
    topics: Array<{ topic: string; papers: number; frequency: number }>;
  }>;
  keyword_heatmap: {
    years: string[];
    rows: Array<{
      keyword: string;
      totals_by_year: number[];
      total_frequency: number;
    }>;
  };
  topic_shifts: {
    emerging: Array<{ topic: string; change: number }>;
    declining: Array<{ topic: string; change: number }>;
  };
  track_topic_sections: Array<{
    track: TrackKey;
    top_topics: Array<{ topic: string; papers: number }>;
  }>;
  topic_by_track_totals: Array<{
    track: TrackKey;
    topics: Array<{ topic: string; papers: number }>;
  }>;
}

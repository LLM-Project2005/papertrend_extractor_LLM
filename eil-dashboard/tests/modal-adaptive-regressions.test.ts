import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizeVisualizationPlan } from "../src/lib/visualization-plan";
import { getViableAdaptiveCharts } from "../src/lib/visualization-planner";
import type { NormalizedAnalyticsPayload } from "../src/types/visualization";

const modalSource = readFileSync(
  new URL("../src/components/ui/Modal.tsx", import.meta.url),
  "utf8"
);
const dashboardSource = readFileSync(
  new URL("../src/components/DashboardClient.tsx", import.meta.url),
  "utf8"
);
const paperModalSource = readFileSync(
  new URL("../src/components/workspace/PaperAnalysisExplorerModal.tsx", import.meta.url),
  "utf8"
);
const visualizationPlannerSource = readFileSync(
  new URL("../src/lib/visualization-planner.ts", import.meta.url),
  "utf8"
);

test("shared modals portal to the document body so transformed ancestors cannot offset them", () => {
  assert.match(modalSource, /createPortal\(/);
  assert.match(modalSource, /document\.body/);
  assert.match(modalSource, /fixed inset-0/);
});

test("paper explorer tabs use an opaque sticky surface without content gaps", () => {
  assert.match(paperModalSource, /sticky top-0 z-20/);
  assert.match(paperModalSource, /dark:bg-\[\#030303\]/);
  assert.doesNotMatch(paperModalSource, /dark:bg-\[\#030303\]\/95/);
});

test("adaptive charts are generated explicitly and preserve a filter snapshot", () => {
  assert.doesNotMatch(
    dashboardSource,
    /!isAdaptiveTab \|\| !data \|\| selectedYears\.length === 0/
  );
  assert.match(dashboardSource, /async function generateAdaptiveCharts\(\)/);
  assert.match(dashboardSource, /setAdaptiveSnapshot\(/);
  assert.match(dashboardSource, /Filters changed\. Existing charts still show the previous snapshot/);
});

test("visualization planning requires a typed chart-builder tool call", () => {
  assert.match(visualizationPlannerSource, /name: "build_adaptive_dashboard"/);
  assert.match(visualizationPlannerSource, /toolChoice: \{ type: "function"/);
  assert.match(visualizationPlannerSource, /getViableAdaptiveCharts/);
});

test("sanitization does not pad a strong one-chart plan with unrelated defaults", () => {
  const plan = sanitizeVisualizationPlan(
    {
      version: "v1",
      mode: "live",
      dashboard_title: "Focused view",
      summary: "Only publication volume is supported.",
      sections: [{
        section_key: "adaptive",
        title: "Volume",
        reason: "The filtered scope supports a year comparison.",
        charts: [{
          chart_key: "adaptive_year_volume",
          title: "Publication volume by year",
          reason: "Compares the available years.",
        }],
      }],
    },
    "live",
    ["EL"],
    false,
    ["adaptive_year_volume"]
  );
  assert.deepEqual(
    plan.sections[0].charts.map((chart) => chart.chart_key),
    ["adaptive_year_volume"]
  );
});

test("flat topic series are rejected while reliable filtered distributions remain viable", () => {
  const analytics: NormalizedAnalyticsPayload = {
    mode: "live",
    approved_chart_types: [],
    filters: { selected_years: [], selected_tracks: ["EL", "LAE"], search_query: "", folder_ids: ["folder-a"], all_folders_selected: false },
    overview: { paper_count: 27, topic_count: 3, keyword_count: 20, year_range: "2017-2022", available_years: ["2017", "2022"], folder_count: 1 },
    canonical_topic_families: [
      { canonical_topic: "Assessment", aliases: [], representative_keywords: [], paper_count: 12, total_keyword_frequency: 30 },
      { canonical_topic: "Teacher learning", aliases: [], representative_keywords: [], paper_count: 9, total_keyword_frequency: 22 },
      { canonical_topic: "Methodology", aliases: [], representative_keywords: [], paper_count: 6, total_keyword_frequency: 14 },
    ],
    yearly_paper_trend: [{ year: "2017", papers: 10 }, { year: "2022", papers: 17 }],
    track_totals: { single: [{ track: "EL", value: 15 }, { track: "LAE", value: 12 }], multi: [] },
    top_topics_over_time: [
      { year: "2017", topics: [{ topic: "Methodology", papers: 1 }] },
      { year: "2022", topics: [{ topic: "Methodology", papers: 1 }] },
    ],
    folder_topic_totals: [],
    yearly_topic_totals: [],
    keyword_heatmap: { years: ["2017", "2022"], rows: [] },
    topic_shifts: { emerging: [], declining: [] },
    track_topic_sections: [],
    topic_by_track_totals: [],
  };
  const viable = getViableAdaptiveCharts(analytics);
  assert.ok(viable.includes("adaptive_year_volume"));
  assert.ok(viable.includes("adaptive_topic_distribution"));
  assert.ok(viable.includes("adaptive_track_distribution"));
  assert.ok(!viable.includes("adaptive_topic_momentum"));
});

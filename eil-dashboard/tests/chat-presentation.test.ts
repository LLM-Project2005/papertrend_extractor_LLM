import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILD_RESEARCH_CHART_TOOL,
  chartToolArguments,
  describeChartRows,
} from "../src/lib/chart-agent";
import {
  dedupeConversationSources,
  previewConversationSources,
} from "../src/lib/conversation-sources";
import { recommendResearchChart } from "../src/lib/chart-recommendation";

test("citation previews show five sources and expose the remaining count", () => {
  const sources = Array.from({ length: 35 }, (_, index) => ({
    paperId: index + 1,
    title: `Paper ${index + 1}`,
    year: "2024",
    href: `/workspace/papers?paperId=${index + 1}`,
    reason: "Evidence",
    sourceType: "paper" as const,
  }));
  const preview = previewConversationSources(sources, 5);
  assert.equal(preview.visible.length, 5);
  assert.equal(preview.remaining, 30);
});

test("conversation sources deduplicate papers and web URLs independently", () => {
  const sources = dedupeConversationSources([
    { paperId: "1", title: "B Paper", year: "2020", href: "/paper/1", reason: "one", sourceType: "paper" as const },
    { paperId: "1", title: "B Paper", year: "2020", href: "/paper/1", reason: "again", sourceType: "paper" as const },
    { paperId: "web-1", title: "A Web", year: "2025", href: "https://example.com/a", reason: "web", sourceType: "web" as const },
    { paperId: "web-2", title: "A Web duplicate", year: "2025", href: "https://example.com/a", reason: "web", sourceType: "web" as const },
  ]);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].sourceType, "paper");
});

test("chart planner exposes a constrained chart-building tool schema", () => {
  assert.equal(BUILD_RESEARCH_CHART_TOOL.function.name, "build_research_charts");
  assert.equal(BUILD_RESEARCH_CHART_TOOL.function.parameters.properties.charts.maxItems, 4);
});

test("chart tool arguments parse the requested validated tool call", () => {
  const parsed = chartToolArguments([{
    type: "function",
    function: {
      name: "build_research_charts",
      arguments: JSON.stringify({ charts: [{ metric: "papers_per_year" }] }),
    },
  }]);
  assert.deepEqual(parsed, { charts: [{ metric: "papers_per_year" }] });
  assert.equal(chartToolArguments([{ function: { name: "another_tool", arguments: "{}" } }]), null);
});

test("chart explanations receive complete rows, totals, and extrema", () => {
  const summary = describeChartRows([
    { label: "2022", value: 2 },
    { label: "2023", value: 7 },
    { label: "2024", value: 4 },
  ], ["value"]);
  assert.equal(summary.rowCount, 3);
  assert.equal(summary.rows.length, 3);
  assert.equal(summary.totals.value, 13);
  assert.equal(summary.extrema.value.highest.label, "2023");
  assert.equal(summary.extrema.value.lowest.label, "2022");
});

test("chart semantics reject unreadable pie charts", () => {
  const result = recommendResearchChart({
    requestedType: "pie",
    temporal: false,
    categoryCount: 14,
    seriesCount: 1,
  });
  assert.equal(result.chartType, "bar");
  assert.match(result.warnings.join(" "), /more than eight categories/i);
});

test("chart semantics preserve ordered time as a line", () => {
  const result = recommendResearchChart({
    requestedType: "bar",
    temporal: true,
    categoryCount: 10,
    seriesCount: 2,
  });
  assert.equal(result.chartType, "line");
});

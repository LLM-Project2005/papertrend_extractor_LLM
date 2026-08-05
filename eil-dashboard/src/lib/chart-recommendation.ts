export type ResearchChartType = "bar" | "line" | "pie" | "table";

export interface ChartSemanticProfile {
  requestedType: ResearchChartType;
  temporal: boolean;
  categoryCount: number;
  seriesCount: number;
}

export interface ChartRecommendation {
  chartType: ResearchChartType;
  reason: string;
  warnings: string[];
}

/**
 * Data-aware validation for an LLM-proposed chart. The model chooses the
 * analytical intent; this guard makes sure the resulting encoding is readable.
 */
export function recommendResearchChart(profile: ChartSemanticProfile): ChartRecommendation {
  const warnings: string[] = [];
  if (profile.requestedType === "table") {
    return {
      chartType: "table",
      reason: "A table preserves exact values and dense comparisons.",
      warnings,
    };
  }
  if (profile.temporal) {
    if (profile.requestedType !== "line") {
      warnings.push("Changed the chart to a line chart because the horizontal dimension is temporal.");
    }
    return {
      chartType: "line",
      reason: "A line chart preserves the ordered time trend.",
      warnings,
    };
  }
  if (profile.requestedType === "pie") {
    if (profile.seriesCount !== 1 || profile.categoryCount > 8) {
      warnings.push(
        "Changed the pie chart to a bar chart because pie slices become misleading with multiple series or more than eight categories."
      );
      return {
        chartType: "bar",
        reason: "A bar chart supports accurate comparison across these categories.",
        warnings,
      };
    }
    return {
      chartType: "pie",
      reason: "A pie chart is readable for this small, single-series part-to-whole distribution.",
      warnings,
    };
  }
  return {
    chartType: profile.requestedType,
    reason: profile.requestedType === "bar"
      ? "A bar chart supports categorical magnitude comparison."
      : "The selected encoding matches the available data semantics.",
    warnings,
  };
}

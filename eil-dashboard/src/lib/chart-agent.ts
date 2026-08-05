import type { ChatCompletionToolCall } from "@/lib/openai";

export const BUILD_RESEARCH_CHART_TOOL = {
  type: "function",
  function: {
    name: "build_research_charts",
    description: "Build one or more validated charts from the available Papertrend repository analytics.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["charts"],
      properties: {
        charts: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["metric", "chartType", "groupBy", "topN", "focusTerms", "title", "reason", "confidence"],
            properties: {
              metric: { type: "string", enum: ["papers_per_year", "word_count", "top_topics", "top_keywords", "track_distribution", "topic_trend", "keyword_trend", "track_trend"] },
              chartType: { type: "string", enum: ["auto", "bar", "line", "pie", "table"] },
              groupBy: { type: "string", enum: ["year", "topic", "keyword", "track"] },
              topN: { type: "integer", minimum: 3, maximum: 25 },
              focusTerms: { type: "array", maxItems: 12, items: { type: "string" } },
              title: { type: "string", maxLength: 120 },
              reason: { type: "string", maxLength: 300 },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
          },
        },
        notes: { type: "string", maxLength: 400 },
      },
    },
  },
} as const;

export function chartToolArguments(toolCalls: ChatCompletionToolCall[]): Record<string, unknown> | null {
  const call = toolCalls.find((item) => item.function?.name === "build_research_charts");
  const rawArguments = call?.function?.arguments;
  if (!rawArguments) return null;
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function describeChartRows(
  data: Array<Record<string, string | number>>,
  yKeys: string[]
) {
  const rows = data.map((row) => ({
    label: String(row.label ?? ""),
    values: Object.fromEntries(yKeys.map((key) => [key, Number(row[key]) || 0])),
  }));
  const totals = Object.fromEntries(yKeys.map((key) => [
    key,
    rows.reduce((sum, row) => sum + row.values[key], 0),
  ]));
  const extrema = Object.fromEntries(yKeys.map((key) => {
    const ranked = [...rows].sort((left, right) => right.values[key] - left.values[key]);
    return [key, {
      highest: ranked[0] ?? null,
      lowest: ranked.length > 1 ? ranked[ranked.length - 1] : ranked[0] ?? null,
    }];
  }));
  return { rowCount: rows.length, rows, totals, extrema };
}

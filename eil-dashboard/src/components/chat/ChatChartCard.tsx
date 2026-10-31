"use client";

/**
 * A chart in a chat answer that was read from the papers: words per paper,
 * participants in each study, a paper's own figures, words in each section.
 *
 * It is drawn with the same charts as the Adaptive tab and the chat's
 * dashboard views (src/components/charts, docs/38), so one conversation has
 * one look: an axis from zero, values beside the bars, counts of papers as
 * squares. It drew with Recharts before, beside charts drawn another way
 * (2026-10-20). Bars that are papers take their paper's research area as
 * their colour when the chart says which that is.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import Bars from "@/components/charts/Bars";
import DataTable from "@/components/charts/DataTable";
import GroupedBars from "@/components/charts/GroupedBars";
import LineChart from "@/components/charts/LineChart";
import Pie, { PIE_MAX_PARTS } from "@/components/charts/Pie";
import StackedBars from "@/components/charts/StackedBars";
import YearColumns from "@/components/charts/YearColumns";
import ChartCsvButton from "@/components/tabs/ChartCsvButton";
import { categoricalColor } from "@/lib/chart-palette";
import { chatChartCsv } from "@/lib/chart-csv";
import PaperLink from "@/components/workspace/PaperLink";
import type { ChatChartPayload } from "@/components/chat/ChatClient";

/** Splits a label into at most `maxLines` lines of `chars` characters; a cut label ends in an ellipsis. */
export function wrapLabel(label: string, chars: number, maxLines = 2): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= chars) {
      line = next;
      used += 1;
      continue;
    }
    if (line) lines.push(line);
    if (lines.length === maxLines) break;
    line = word.length > chars ? `${word.slice(0, chars - 1)}…` : word;
    used += 1;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const cut = used < words.length || lines.some((text) => text.endsWith("…"));
  if (cut && lines.length > 0) {
    const last = lines[lines.length - 1].replace(/…$/, "");
    lines[lines.length - 1] = `${last.slice(0, Math.max(1, chars - 1))}…`;
  }
  return lines.slice(0, maxLines);
}

/** A table cell: a figure a paper does not give is a dash, not a zero. */
function tableValue(value: string | number | undefined): string {
  const number = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(number)) return "–";
  return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Where each value read from the papers comes from: the value, its paper and
 * the paper's own sentence, so a reader can check a bar without opening it.
 */
function ChartSources({ sources }: { sources: NonNullable<ChatChartPayload["sources"]> }) {
  return (
    <details className="border-t border-hairline">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink hover:text-ink">
        Where each value comes from ({sources.length})
      </summary>
      <ul data-paper-list="" className="max-h-[420px] space-y-3 overflow-auto px-4 pb-4">
        {sources.map((source, index) => (
          <li key={`${source.paperId}-${index}`} className="text-sm leading-6">
            <p className="text-ink">
              <span className="font-semibold">{source.value}</span>
              {source.note ? <span className="text-body"> ({source.note})</span> : null}
              <span className="text-mute"> · </span>
              {/* With its sentence, the paper opens on its PDF with that sentence marked, as a citation does. */}
              <PaperLink
                paper={source.quote ? { paperId: source.paperId, tab: "preview", quote: source.quote } : { paperId: source.paperId }}
                className="text-ink underline-offset-2 hover:underline"
              >
                {source.title}
              </PaperLink>
              {source.year && source.year !== "Unknown" ? <span className="text-mute"> · {source.year}</span> : null}
            </p>
            {source.quote ? (
              <blockquote className="mt-1 border-l-2 border-slate-300 pl-3 text-body dark:border-[#3a3a3a]">
                {source.quote}
              </blockquote>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** "Words", "participants": what a chart's one series measures, for its axis. */
function unitOf(key: string): string {
  return key.replace(/^Median /, "median ").trim();
}

function Plot({ chart }: { chart: ChatChartPayload }) {
  const data = chart.data ?? [];
  const keys = chart.yKeys.length > 0 ? chart.yKeys : ["value"];
  const label = (row: Record<string, string | number>) => String(row.label ?? "");
  const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  if (chart.chartType === "table") {
    return (
      <DataTable
        columns={[{ key: "label", label: "Label" }, ...keys.map((key) => ({ key, label: key, align: "right" as const }))]}
        rows={data.map((row, index) => ({
          key: `${label(row)}-${index}`,
          cells: Object.fromEntries([["label", label(row)], ...keys.map((key) => [key, tableValue(row[key])])]),
        }))}
        caption={chart.title}
      />
    );
  }

  if (chart.chartType === "line") {
    return <LineChart labels={data.map(label)} series={keys.map((key, index) => ({ label: keys.length > 1 ? key : "", values: data.map((row) => number(row[key])), color: categoricalColor(index) }))} unit={keys.length === 1 ? unitOf(keys[0]) : undefined} />;
  }

  if (chart.chartType === "pie" && keys.length === 1 && data.length <= PIE_MAX_PARTS) {
    return <Pie slices={data.map((row, index) => ({ key: `${label(row)}-${index}`, label: label(row), value: number(row[keys[0]]) ?? 0 }))} unit={keys[0].toLowerCase()} />;
  }

  if (chart.stacked && keys.length > 1) {
    return <StackedBars series={keys} rows={data.map((row, index) => ({ key: `${label(row)}-${index}`, label: label(row), parts: keys.map((key) => number(row[key]) ?? 0) }))} unit="words" />;
  }

  if (keys.length > 1) {
    return (
      <GroupedBars
        series={keys.map((key, index) => ({ key, label: key, color: categoricalColor(index) }))}
        rows={data.map((row, index) => ({ key: `${label(row)}-${index}`, label: label(row), values: keys.map((key) => number(row[key])) }))}
        measure="value"
        initialRows={12}
      />
    );
  }

  const key = keys[0];
  // Years along the axis are columns; anything else is bars.
  if (data.length >= 2 && data.every((row) => /^\d{4}$/.test(label(row)))) {
    return <YearColumns points={data.map((row) => ({ key: label(row), label: label(row), value: number(row[key]) ?? 0 }))} measure="value" unit={unitOf(key)} />;
  }
  // Answers counted by the papers that give them ("Papers"): squares, out of the papers that answered.
  const papersCounted = /^papers$/i.test(key);
  const answered = new Set((chart.sources ?? []).map((source) => source.paperId)).size;
  const groups = chart.groups;
  const groupNames = groups ? [...new Set(Object.values(groups.byPaper))].sort((a, b) => a.localeCompare(b)) : [];
  const colorOf = (row: Record<string, string | number>) => {
    const paperId = row.paperId === undefined ? undefined : String(row.paperId);
    const group = paperId && groups ? groups.byPaper[paperId] : undefined;
    return group ? categoricalColor(groupNames.indexOf(group)) : undefined;
  };
  const colored = groupNames.length > 0 && data.some((row) => colorOf(row));
  return (
    <Bars
      rows={data.map((row, index) => ({ key: `${label(row)}-${index}`, label: label(row), value: number(row[key]) ?? 0, color: colored ? colorOf(row) ?? "rgb(var(--mute) / 0.6)" : undefined }))}
      measure={papersCounted ? "papers" : "value"}
      total={papersCounted && answered > 0 ? answered : undefined}
      unit={papersCounted ? undefined : unitOf(key)}
      axisLabel={papersCounted && answered > 0 ? `Papers, out of the ${answered} that state it` : undefined}
      legend={colored ? groupNames.map((name, index) => ({ label: name, color: categoricalColor(index) })) : undefined}
      initialRows={data.length <= 16 ? data.length : 12}
    />
  );
}

export default function ChatChartCard({ chart }: { chart: ChatChartPayload }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm" data-chat-chart={chart.metric}>
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-body">Chart · {chart.scopeLabel}</p>
          <h3 className="mt-1 text-base font-semibold leading-6 text-ink">{chart.title}</h3>
        </div>
        <ChartCsvButton csv={chatChartCsv({ ...chart, data: chart.data ?? [] })} />
      </div>
      <div className="px-4 py-4">
        <Plot chart={chart} />
      </div>
      {chart.sources && chart.sources.length > 0 ? <ChartSources sources={chart.sources} /> : null}
    </div>
  );
}

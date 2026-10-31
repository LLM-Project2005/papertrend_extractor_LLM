"use client";

/*
 * Draws one insight with the shared charts (src/components/charts, docs/38).
 * Every value comes from the insight object itself - the same object the
 * model was shown - so the chart and its words cannot drift apart.
 *
 * Insights saved before docs/38 are still drawn: their bars kept a grey
 * "40% of papers" line under each label, which is dropped (the switch shows
 * shares now), and their comparisons kept shares only, which are drawn as
 * shares.
 */
// React in scope: the test runner compiles JSX the classic way.
import React from "react";
import Bars, { type BarDatum } from "@/components/charts/Bars";
import DataTable from "@/components/charts/DataTable";
import GroupedBars, { type GroupRow, type GroupSeries } from "@/components/charts/GroupedBars";
import HeatGrid from "@/components/charts/HeatGrid";
import StatTile from "@/components/charts/StatTile";
import YearColumns from "@/components/charts/YearColumns";
import type { CompareRow, Insight, LifecycleRow } from "@/lib/insights/types";
import type { PaperId } from "@/types/database";

export type OpenPapers = (paperIds: PaperId[], label: string) => void;

/** The two groups of a comparison: earlier in grey and later in the accent; a subject in the accent against the rest in grey. */
const ACCENT = "rgb(var(--accent))";
const GREY = "rgb(var(--mute) / 0.7)";

/** A line under a bar that only restated its share ("40% of papers", "25% here · 17% of all papers"). */
function legacyShare(detail: string | undefined): boolean {
  return Boolean(detail && /\d+%/.test(detail));
}

function PapersButton({ ids, label, onOpen, children }: { ids: PaperId[]; label: string; onOpen: OpenPapers; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(ids, label)}
      className="rounded text-left underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:underline"
      title={`Show the ${ids.length} paper${ids.length === 1 ? "" : "s"}`}
    >
      {children}
    </button>
  );
}

function compareSeries(chart: Extract<Insight["chart"], { kind: "compare" }>, rows: CompareRow[]): GroupSeries[] {
  const sameOf = (side: "leftOf" | "rightOf") => {
    const sizes = new Set(rows.map((row) => row[side]));
    return sizes.size === 1 ? rows[0]?.[side] : undefined;
  };
  const [left, right] = chart.sequence === "time" ? [GREY, ACCENT] : [ACCENT, GREY];
  return [
    { key: "left", label: chart.leftLabel, color: left, of: sameOf("leftOf") },
    { key: "right", label: chart.rightLabel, color: right, of: sameOf("rightOf") },
  ];
}

function CompareChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  const chart = insight.chart;
  if (chart.kind !== "compare") return null;
  const counted = chart.rows.every((row) => row.leftCount !== undefined && row.rightCount !== undefined && row.leftOf && row.rightOf);
  const toRow = (row: CompareRow): GroupRow => ({
    key: `${row.group ?? ""}|${row.label}`,
    label: row.label,
    tag: row.tag,
    emphasis: row.asked,
    values: counted ? [row.leftCount as number, row.rightCount as number] : [row.left, row.right],
    of: counted ? [row.leftOf, row.rightOf] : undefined,
    paperIds: row.paperIds,
  });
  const groups = [...new Set(chart.rows.map((row) => row.group ?? ""))];
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const rows = chart.rows.filter((row) => (row.group ?? "") === group);
        return (
          <div key={group || "all"}>
            {group ? <p className="mb-2 text-sm font-semibold text-ink">{group}</p> : null}
            <GroupedBars series={compareSeries(chart, rows)} rows={rows.map(toRow)} measure={counted ? "papers" : "percentOnly"} onOpen={onOpen} />
          </div>
        );
      })}
    </div>
  );
}

const STATUS: Record<LifecycleRow["status"], { label: string; tone: string }> = {
  new: { label: "New", tone: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300" },
  fading: { label: "Faded", tone: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  enduring: { label: "Throughout", tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  burst: { label: "One burst", tone: "bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300" },
};

/** Papers per year for one theme, on the chart's shared years: every theme on the same scale. */
function Sparkline({ series, max }: { series: number[]; max: number }) {
  const width = 100 / Math.max(series.length, 1);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <line x1="0" y1="23.5" x2="100" y2="23.5" className="stroke-hairline-strong" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {series.map((value, index) =>
        value > 0 ? (
          <rect key={index} x={index * width + width * 0.15} width={width * 0.7} y={24 - (value / max) * 22} height={(value / max) * 22} rx="0.8" className="fill-accent" />
        ) : null
      )}
    </svg>
  );
}

function LifecyclesChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  const chart = insight.chart;
  if (chart.kind !== "lifecycles") return null;
  const first = chart.years[0];
  const last = chart.years[chart.years.length - 1];
  const max = Math.max(1, ...chart.rows.flatMap((row) => row.series));
  return (
    <div data-chart="lifecycles">
      <p className="mb-3 text-xs font-medium text-body">Papers on each theme per year, {first}–{last}; the tallest mark is {max} paper{max === 1 ? "" : "s"}</p>
      <ul className="space-y-2">
        {chart.rows.map((row) => (
          <li key={row.label} className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_7rem] sm:items-center sm:gap-4">
            <p className="flex min-w-0 items-center gap-2 text-sm leading-5 text-ink">
              <span className={`inline-flex flex-none rounded-full px-1.5 py-0.5 text-[11px] font-medium ${STATUS[row.status].tone}`}>{STATUS[row.status].label}</span>
              <PapersButton ids={row.paperIds} label={row.label} onOpen={onOpen}>
                <span className="line-clamp-2">{row.label}</span>
              </PapersButton>
            </p>
            <Sparkline series={row.series} max={max} />
            <p className="text-xs tabular-nums text-body sm:text-right">
              {row.first === row.last ? row.first : `${row.first}–${row.last}`}, {row.papers} papers
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between text-[11px] tabular-nums text-mute sm:ml-[17rem] sm:mr-[8rem]">
        <span>{first}</span>
        <span>{last}</span>
      </p>
    </div>
  );
}

function ListChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  const chart = insight.chart;
  if (chart.kind !== "list") return null;
  return (
    <ul className="divide-y divide-hairline" data-chart="list">
      {chart.rows.map((row) => (
        <li key={row.title} className="py-2.5 first:pt-0 last:pb-0">
          <p className="text-sm font-medium leading-5 text-ink">
            <PapersButton ids={row.paperIds} label={row.title} onOpen={onOpen}>
              {row.title}
            </PapersButton>
          </p>
          <p className="mt-0.5 text-[13px] leading-5 text-body">{row.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export default function InsightChart({ insight, onOpen, paperTitles }: { insight: Insight; onOpen: OpenPapers; paperTitles?: Map<string, string> }) {
  const chart = insight.chart;
  const total = insight.population?.papers;
  switch (chart.kind) {
    case "bars": {
      if (chart.layout === "columns") {
        return (
          <YearColumns
            points={chart.rows.map((row) => ({ key: row.label, label: row.label, value: row.value, paperIds: row.paperIds }))}
            measure={chart.unit === "papers" ? "papers" : "value"}
            onOpen={onOpen}
            paperTitles={paperTitles}
          />
        );
      }
      const rows: BarDatum[] = chart.rows.map((row) => ({
        key: row.label,
        label: row.label,
        sub: legacyShare(row.detail) ? undefined : row.detail,
        value: row.value,
        paperIds: row.paperIds,
        emphasis: chart.emphasis?.includes(row.label),
      }));
      return chart.unit === "papers" ? (
        <Bars rows={rows} measure="papers" total={total} onOpen={onOpen} paperTitles={paperTitles} />
      ) : (
        <Bars rows={rows} measure="value" unit={chart.unit === "percent" ? "%" : chart.unit} axisLabel={chart.valueLabel} onOpen={onOpen} />
      );
    }
    case "pairs":
      return (
        <Bars
          rows={chart.rows.map((row) => ({
            key: `${row.a}|${row.b}`,
            label: `${row.a} with ${row.b}`,
            sub: `${Math.round(row.lift * 10) / 10} times as often as their sizes predict (${row.aPapers} and ${row.bPapers} papers)`,
            value: row.together,
            paperIds: row.paperIds,
          }))}
          measure="papers"
          total={total}
          axisLabel={`Papers on both themes${total ? `, out of ${total}` : ""}`}
          onOpen={onOpen}
          paperTitles={paperTitles}
        />
      );
    case "matrix":
      return (
        <HeatGrid
          rowLabel={chart.rowLabel}
          colLabel={chart.colLabel}
          rows={chart.rows}
          cols={chart.cols}
          values={chart.values}
          paperIds={chart.paperIds}
          rowTotals={chart.rowTotals}
          marks={chart.marks}
          onOpen={onOpen}
        />
      );
    case "compare":
      return <CompareChart insight={insight} onOpen={onOpen} />;
    case "lifecycles":
      return <LifecyclesChart insight={insight} onOpen={onOpen} />;
    case "list":
      return <ListChart insight={insight} onOpen={onOpen} />;
    case "table":
      return (
        <DataTable
          columns={chart.columns}
          rows={chart.rows.map((row) => ({ key: row.key, cells: row.cells, paperId: row.paperIds.length === 1 ? row.paperIds[0] : undefined }))}
          onOpen={onOpen}
          caption={insight.question}
        />
      );
    case "stat":
      return <StatTile value={chart.value} label={chart.label} detail={chart.detail} paperIds={insight.paperIds} onOpen={onOpen} />;
    default:
      return null;
  }
}

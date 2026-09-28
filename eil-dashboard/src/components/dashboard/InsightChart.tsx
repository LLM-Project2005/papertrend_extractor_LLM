"use client";

/*
 * Draws one insight. Every value comes from the insight object itself - the
 * same object the model was shown - so the chart and its words cannot drift
 * apart. They are plain elements rather than a chart library: every label is
 * shown in full and wraps at phone width, where a chart's axis would cut it.
 */
import { useTheme } from "@/components/theme/ThemeProvider";
import type { Insight, LifecycleRow } from "@/lib/insights/types";
import type { PaperId } from "@/types/database";

export type OpenPapers = (paperIds: PaperId[], label: string) => void;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function PapersButton({ ids, label, onOpen, children }: { ids: PaperId[]; label: string; onOpen: OpenPapers; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(ids, label)}
      className="rounded text-left underline-offset-2 transition-colors hover:text-slate-950 hover:underline focus-visible:underline dark:hover:text-white"
      title={`Show the ${ids.length} paper${ids.length === 1 ? "" : "s"}`}
    >
      {children}
    </button>
  );
}

function BarsChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  const chart = insight.chart;
  if (chart.kind !== "bars") return null;
  const max = Math.max(...chart.rows.map((row) => row.value), 1);
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500 dark:text-[#8f8f8f]">{chart.valueLabel}</p>
      <ul className="space-y-2.5">
        {chart.rows.map((row) => (
          <li key={row.label} className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm leading-5 text-slate-800 dark:text-[#e5e5e5]">
                <PapersButton ids={row.paperIds} label={row.label} onOpen={onOpen}>
                  {row.label}
                </PapersButton>
              </p>
              {row.detail ? <p className="text-xs leading-4 text-slate-500 dark:text-[#8f8f8f]">{row.detail}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1a1a1a]" aria-hidden>
                <span className="block h-full rounded-full bg-slate-700 dark:bg-[#d4d4d4]" style={{ width: `${(row.value / max) * 100}%` }} />
              </span>
              <span className="w-10 flex-none text-right text-xs tabular-nums text-slate-700 dark:text-[#d4d4d4]">{row.value}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PairsChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  const chart = insight.chart;
  if (chart.kind !== "pairs") return null;
  const max = Math.max(...chart.rows.map((row) => row.together), 1);
  return (
    <ul className="space-y-3">
      {chart.rows.map((row) => (
        <li key={`${row.a}|${row.b}`} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center sm:gap-4">
          <p className="min-w-0 text-sm leading-5 text-slate-800 dark:text-[#e5e5e5]">
            <PapersButton ids={row.paperIds} label={`${row.a} with ${row.b}`} onOpen={onOpen}>
              <span className="font-medium">{row.a}</span>
              <span className="text-slate-500 dark:text-[#8f8f8f]"> with </span>
              <span className="font-medium">{row.b}</span>
            </PapersButton>
          </p>
          <div className="flex items-center gap-3">
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1a1a1a]">
              <span className="block h-full rounded-full bg-slate-700 dark:bg-[#d4d4d4]" style={{ width: `${(row.together / max) * 100}%` }} />
            </span>
            <span className="w-32 flex-none text-right text-xs tabular-nums text-slate-600 dark:text-[#a3a3a3]">
              {row.together} papers · {Math.round(row.lift * 10) / 10}× chance
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MatrixChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  const chart = insight.chart;
  const { theme, hydrated } = useTheme();
  const isDark = hydrated && theme === "dark";
  if (chart.kind !== "matrix") return null;
  const max = Math.max(...chart.values.flat(), 1);
  const mark = new Map(chart.marks.map(([row, col, kind]) => [`${row}:${col}`, kind]));
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-xs">
        <caption className="sr-only">
          Papers per {chart.rowLabel.toLowerCase()} and {chart.colLabel.toLowerCase()}. Outlined cells are strong pairings; dashed cells are notable absences.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-48 text-left font-medium text-slate-500 dark:text-[#8f8f8f]">
              {chart.rowLabel} by {chart.colLabel.toLowerCase()}
            </th>
            {chart.cols.map((col) => (
              <th key={col} scope="col" className="max-w-[7rem] px-1 pb-1 text-left align-bottom font-medium leading-4 text-slate-600 dark:text-[#b3b3b3]">
                <span className="line-clamp-3" title={col}>{col}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, r) => (
            <tr key={row}>
              <th scope="row" className="pr-2 text-left font-normal leading-4 text-slate-700 dark:text-[#d4d4d4]">
                <span className="line-clamp-2" title={row}>{row}</span>
              </th>
              {chart.cols.map((col, c) => {
                const value = chart.values[r][c];
                const kind = mark.get(`${r}:${c}`);
                const strength = value / max;
                const background = value === 0
                  ? "transparent"
                  : isDark
                    ? `rgba(229, 229, 229, ${0.12 + strength * 0.7})`
                    : `rgba(38, 38, 38, ${0.08 + strength * 0.72})`;
                const dark = isDark ? strength > 0.55 : strength > 0.5;
                const text = value === 0 ? (isDark ? "#8f8f8f" : "#707070") : isDark ? (dark ? "#0a0a0a" : "#f5f5f5") : dark ? "#fafafa" : "#262626";
                return (
                  <td key={col} className="p-0">
                    <button
                      type="button"
                      disabled={value === 0}
                      onClick={() => onOpen(chart.paperIds[r][c], `${row} with ${col}`)}
                      aria-label={`${row} with ${col}: ${value} paper${value === 1 ? "" : "s"}${kind === "strong" ? ", a strong pairing" : kind === "absent" ? ", none where some were expected" : ""}`}
                      className={`flex h-9 w-full min-w-[3rem] items-center justify-center rounded-md tabular-nums transition-transform enabled:hover:scale-[1.04] ${
                        kind === "strong"
                          ? "ring-2 ring-sky-600 ring-offset-1 ring-offset-white dark:ring-sky-400 dark:ring-offset-black"
                          : kind === "absent"
                            ? "border border-dashed border-amber-600 dark:border-amber-400"
                            : value === 0
                              ? "border border-slate-100 dark:border-[#1a1a1a]"
                              : ""
                      }`}
                      style={{ background, color: text }}
                    >
                      {value}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {chart.marks.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-[#a3a3a3]">
          {chart.marks.some(([, , kind]) => kind === "strong") ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-sky-600 dark:ring-sky-400" /> A strong pairing
            </span>
          ) : null}
          {chart.marks.some(([, , kind]) => kind === "absent") ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-amber-600 dark:border-amber-400" /> None, where about 3 were expected
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function CompareChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  const chart = insight.chart;
  if (chart.kind !== "compare") return null;
  const max = Math.max(...chart.rows.flatMap((row) => [row.left, row.right]), 10);
  const scale = (value: number) => `${(value / max) * 100}%`;
  const groups = [...new Set(chart.rows.map((row) => row.group ?? ""))];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-[#a3a3a3]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-slate-500 bg-white dark:border-[#8f8f8f] dark:bg-black" /> {chart.leftLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-900 dark:bg-white" /> {chart.rightLabel}
        </span>
        <span>Share of papers, %</span>
      </div>
      {groups.map((group) => (
        <div key={group || "all"} className="mt-2 first:mt-0">
          {group ? <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-[#8f8f8f]">{group}</p> : null}
          <ul className="space-y-2.5">
            {chart.rows
              .filter((row) => (row.group ?? "") === group)
              .map((row) => {
                const low = Math.min(row.left, row.right);
                const high = Math.max(row.left, row.right);
                return (
                  <li key={`${group}|${row.label}`} className="grid gap-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
                    <p className="min-w-0 text-sm leading-5 text-slate-800 dark:text-[#e5e5e5]">
                      <PapersButton ids={row.paperIds} label={row.label} onOpen={onOpen}>
                        {row.label}
                      </PapersButton>
                      {row.tag ? (
                        <span
                          className={`ml-2 inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                            row.tag === "gaining"
                              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                          }`}
                        >
                          {row.tag}
                        </span>
                      ) : null}
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="relative h-5 flex-1" aria-hidden>
                        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200 dark:bg-[#262626]" />
                        <span
                          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-400 dark:bg-[#5c5c5c]"
                          style={{ left: scale(low), width: `calc(${scale(high)} - ${scale(low)})` }}
                        />
                        <span
                          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-500 bg-white dark:border-[#8f8f8f] dark:bg-black"
                          style={{ left: scale(row.left) }}
                        />
                        <span
                          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-900 dark:bg-white"
                          style={{ left: scale(row.right) }}
                        />
                      </div>
                      <span className="w-20 flex-none text-right text-xs tabular-nums text-slate-600 dark:text-[#a3a3a3]">
                        {row.left}% {chart.sequence === "time" ? "→" : "vs"} {row.right}%
                      </span>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
}

const STATUS: Record<LifecycleRow["status"], { label: string; tone: string }> = {
  new: { label: "New", tone: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300" },
  fading: { label: "Faded", tone: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  enduring: { label: "Throughout", tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  burst: { label: "One burst", tone: "bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300" },
};

function Sparkline({ series }: { series: number[] }) {
  const max = Math.max(...series, 1);
  const width = 100 / Math.max(series.length, 1);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <line x1="0" y1="23.5" x2="100" y2="23.5" className="stroke-slate-200 dark:stroke-[#262626]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {series.map((value, index) =>
        value > 0 ? (
          <rect
            key={index}
            x={index * width + width * 0.15}
            width={width * 0.7}
            y={24 - (value / max) * 22}
            height={(value / max) * 22}
            rx="0.8"
            className="fill-slate-700 dark:fill-[#d4d4d4]"
          />
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
  return (
    <div>
      <ul className="space-y-2">
        {chart.rows.map((row) => (
          <li key={row.label} className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_7rem] sm:items-center sm:gap-4">
            <p className="flex min-w-0 items-center gap-2 text-sm leading-5 text-slate-800 dark:text-[#e5e5e5]">
              <span className={`inline-flex flex-none rounded-full px-1.5 py-0.5 text-[11px] font-medium ${STATUS[row.status].tone}`}>
                {STATUS[row.status].label}
              </span>
              <PapersButton ids={row.paperIds} label={row.label} onOpen={onOpen}>
                <span className="line-clamp-2">{row.label}</span>
              </PapersButton>
            </p>
            <Sparkline series={row.series} />
            <p className="text-xs tabular-nums text-slate-600 dark:text-[#a3a3a3] sm:text-right">
              {row.first === row.last ? row.first : `${row.first}–${row.last}`} · {row.papers} papers
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between text-[11px] tabular-nums text-slate-500 dark:text-[#8f8f8f] sm:ml-[17rem] sm:mr-[8rem]">
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
    <ul className="divide-y divide-slate-100 dark:divide-[#1a1a1a]">
      {chart.rows.map((row) => (
        <li key={row.title} className="py-2.5 first:pt-0 last:pb-0">
          <p className="text-sm font-medium leading-5 text-slate-900 dark:text-[#f2f2f2]">
            <PapersButton ids={row.paperIds} label={row.title} onOpen={onOpen}>
              {row.title}
            </PapersButton>
          </p>
          <p className="mt-0.5 text-[13px] leading-5 text-slate-600 dark:text-[#a3a3a3]">{row.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export default function InsightChart({ insight, onOpen }: { insight: Insight; onOpen: OpenPapers }) {
  switch (insight.chart.kind) {
    case "bars":
      return <BarsChart insight={insight} onOpen={onOpen} />;
    case "pairs":
      return <PairsChart insight={insight} onOpen={onOpen} />;
    case "matrix":
      return <MatrixChart insight={insight} onOpen={onOpen} />;
    case "compare":
      return <CompareChart insight={insight} onOpen={onOpen} />;
    case "lifecycles":
      return <LifecyclesChart insight={insight} onOpen={onOpen} />;
    case "list":
      return <ListChart insight={insight} onOpen={onOpen} />;
    default:
      return null;
  }
}

"use client";

/*
 * A chart in chat, drawn by the Adaptive tab's renderer from a computed
 * insight (docs/31, phase 1): the same chart, labels in full, the same
 * "based on" line, and the papers behind any bar one press away - each opening
 * in place, like a citation.
 */
import { useState } from "react";
import InsightChart from "@/components/dashboard/InsightChart";
import PaperLink from "@/components/workspace/PaperLink";
import type { Insight } from "@/lib/insights/types";
import type { PaperId } from "@/types/database";

export interface ChatInsightChartView {
  title: string;
  scopeLabel: string;
  insight: Insight;
  papers?: Array<{ id: string; title: string; year: string }>;
}

export default function ChatInsightCard({ chart }: { chart: ChatInsightChartView }) {
  const [open, setOpen] = useState<{ label: string; ids: string[] } | null>(null);
  const titles = new Map((chart.papers ?? []).map((paper) => [paper.id, paper]));
  const onOpen = (paperIds: PaperId[], label: string) => {
    const ids = paperIds.map(String);
    setOpen((current) => (current && current.label === label && current.ids.length === ids.length ? null : { label, ids }));
  };
  const insight = chart.insight;
  const listed = open ? open.ids.map((id) => titles.get(id) ?? { id, title: "Untitled paper", year: "Unknown" }) : [];

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]" data-chat-insight={insight.id}>
      <div className="border-b border-slate-200 px-4 py-3 dark:border-[#1f1f1f]">
        <p className="text-xs font-semibold text-slate-600 dark:text-[#a3a3a3]">Chart · {chart.scopeLabel}</p>
        <h3 className="mt-1 text-base font-semibold leading-6 text-slate-900 dark:text-white">{chart.title}</h3>
        {insight.caution ? <p className="mt-1 text-[13px] leading-5 text-amber-900 dark:text-amber-200">{insight.caution}</p> : null}
      </div>
      <div className="px-4 py-4">
        <InsightChart insight={insight} onOpen={onOpen} />
      </div>
      {open ? (
        <div className="border-t border-slate-200 px-4 py-3 dark:border-[#1f1f1f]" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {open.label} · {listed.length} paper{listed.length === 1 ? "" : "s"}
            </p>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-950 dark:text-[#a3a3a3] dark:hover:text-white"
            >
              Close
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {listed.map((paper) => (
              <li key={paper.id} className="text-sm leading-5">
                <PaperLink paper={{ paperId: paper.id }} className="text-slate-800 underline-offset-2 hover:underline dark:text-[#e5e5e5]">
                  {paper.title}
                </PaperLink>
                <span className="text-slate-500 dark:text-[#8f8f8f]">{paper.year !== "Unknown" ? ` · ${paper.year}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 dark:border-[#1a1a1a]">
        <p className="max-w-2xl text-xs leading-5 text-slate-600 dark:text-[#8f8f8f]">{insight.basis}</p>
        <button
          type="button"
          onClick={() => onOpen(insight.paperIds, chart.title)}
          className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#262626] dark:text-[#d4d4d4] dark:hover:border-[#3a3a3a] dark:hover:text-white"
        >
          The {insight.paperIds.length} paper{insight.paperIds.length === 1 ? "" : "s"} behind this
        </button>
      </div>
    </section>
  );
}

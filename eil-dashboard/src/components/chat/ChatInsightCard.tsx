"use client";

/*
 * A chart in chat, drawn by the Adaptive tab's renderer from a computed
 * insight (docs/31, phase 1): the same chart, labels in full, the same
 * "based on" line, and the papers behind any bar one press away - each opening
 * in place, like a citation.
 */
import { useState } from "react";
import InsightChart from "@/components/dashboard/InsightChart";
import ChartCsvButton from "@/components/tabs/ChartCsvButton";
import PaperLink from "@/components/workspace/PaperLink";
import { insightCsv } from "@/lib/insights/csv";
import { yearLabel } from "@/lib/paper-year";
import { buttonClass } from "@/components/ui/controls";
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
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-raise" data-chat-insight={insight.id}>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-xs font-semibold text-body">Chart · {chart.scopeLabel}</p>
        <h3 className="mt-1 text-base font-semibold leading-6 text-ink">{chart.title}</h3>
        {insight.caution ? <p className="mt-1 text-[13px] leading-5 text-amber-900 dark:text-amber-200">{insight.caution}</p> : null}
      </div>
      <div className="px-4 py-4">
        <InsightChart insight={insight} onOpen={onOpen} paperTitles={new Map([...titles.entries()].map(([id, paper]) => [id, paper.title]))} />
      </div>
      {open ? (
        <div className="border-t border-hairline px-4 py-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              {open.label}: {listed.length} paper{listed.length === 1 ? "" : "s"}
            </p>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className={buttonClass("ghost", "sm")}
            >
              Close
            </button>
          </div>
          <ul data-paper-list="" className="mt-2 space-y-1.5">
            {listed.map((paper) => (
              <li key={paper.id} className="text-sm leading-5">
                <PaperLink paper={{ paperId: paper.id }} className="text-ink underline-offset-2 hover:underline">
                  {paper.title}
                </PaperLink>
                <span className="text-mute">, {yearLabel(paper.year)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-3">
        <p className="max-w-2xl text-xs leading-5 text-body">{insight.basis}</p>
        <ChartCsvButton csv={insightCsv(insight, chart.title)} />
        <button
          type="button"
          onClick={() => onOpen(insight.paperIds, chart.title)}
          className={buttonClass("secondary", "sm")}
        >
          The {insight.paperIds.length} paper{insight.paperIds.length === 1 ? "" : "s"} behind this
        </button>
      </div>
    </section>
  );
}

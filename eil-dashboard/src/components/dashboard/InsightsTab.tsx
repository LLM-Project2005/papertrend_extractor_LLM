"use client";

/*
 * The Adaptive tab (docs/30): patterns in the selected papers that no fixed
 * tab shows, each with the numbers behind it.
 *
 * Opening the tab costs nothing: the insights are computed on the server, and a
 * write-up a model already made for exactly these papers comes from the cache.
 * "Write up with AI" makes one short model call that picks, orders and words
 * the insights; a checker holds every number it writes to the computed facts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InsightChart, { type OpenPapers } from "@/components/dashboard/InsightChart";
import { ChartIcon, SparkIcon, SpinnerIcon, InfoIcon } from "@/components/ui/Icons";
import type { Insight, InsightNotice, InsightPlan, InsightReport } from "@/lib/insights/types";
import type { PaperId } from "@/types/database";

interface InsightsResponse {
  report: InsightReport;
  plan: InsightPlan;
  cached?: boolean;
  notice?: string;
  error?: string;
}

interface Props {
  projectId: string | null;
  accessToken: string | null;
  selectedYears: string[];
  selectedTracks: string[];
  searchQuery: string;
  /** Changes when the repository's data does (a refresh, new papers). */
  dataVersion: string;
  onOpenPapers: (paperIds: PaperId[], label: string) => void;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

function InsightCard({
  insight,
  title,
  takeaway,
  onOpen,
  index,
}: {
  insight: Insight;
  title: string;
  takeaway: string;
  onOpen: OpenPapers;
  index: number;
}) {
  return (
    <section className="app-surface px-4 py-5 sm:px-6" aria-labelledby={`insight-${insight.id}`} data-insight={insight.id}>
      <p className="text-xs font-medium text-slate-500 dark:text-[#8f8f8f]">
        {index + 1} · {insight.question}
      </p>
      <h3 id={`insight-${insight.id}`} className="mt-1.5 text-base font-semibold leading-6 text-slate-900 dark:text-white">
        {title}
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700 dark:text-[#d4d4d4]" data-takeaway>
        {takeaway}
      </p>
      <div className="mt-5">
        <InsightChart insight={insight} onOpen={onOpen} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-[#1a1a1a]">
        <p className="max-w-2xl text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">{insight.basis}</p>
        <button
          type="button"
          onClick={() => onOpen(insight.paperIds, title)}
          className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#262626] dark:text-[#d4d4d4] dark:hover:border-[#3a3a3a] dark:hover:text-white"
        >
          The {insight.paperIds.length} paper{insight.paperIds.length === 1 ? "" : "s"} behind this
        </button>
      </div>
    </section>
  );
}

function Notices({ notices }: { notices: Array<Pick<InsightNotice, "id" | "text">> }) {
  if (notices.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="About this selection">
      {notices.map((notice) => (
        <li key={notice.id} className="flex gap-2 text-sm leading-6 text-slate-600 dark:text-[#b8b8b8]">
          <InfoIcon className="mt-1 h-4 w-4 flex-none text-slate-400 dark:text-[#737373]" />
          <span>{notice.text}</span>
        </li>
      ))}
    </ul>
  );
}

export default function InsightsTab({
  projectId,
  accessToken,
  selectedYears,
  selectedTracks,
  searchQuery,
  dataVersion,
  onOpenPapers,
}: Props) {
  const [result, setResult] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const requestId = useRef(0);

  const body = useMemo(
    () => ({ projectId, selectedYears, selectedTracks, searchQuery: searchQuery.trim() }),
    [projectId, searchQuery, selectedTracks, selectedYears]
  );

  const load = useCallback(
    async (mode: "auto" | "write", refresh = false) => {
      if (!projectId || !accessToken) return;
      const id = (requestId.current += 1);
      if (mode === "write") setWriting(true);
      else setLoading(true);
      setError(null);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 40_000);
      try {
        const response = await fetch("/api/workspace/insights", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ...body, mode, refresh }),
        });
        const payload = (await response.json().catch(() => ({}))) as InsightsResponse;
        if (id !== requestId.current) return;
        if (!response.ok || !payload.report || !payload.plan) {
          throw new Error(payload.error || "The insights could not be loaded.");
        }
        setResult(payload);
      } catch (loadError) {
        if (id !== requestId.current) return;
        setError(
          loadError instanceof DOMException && loadError.name === "AbortError"
            ? "That took too long. Try again in a moment."
            : loadError instanceof Error
              ? loadError.message
              : "The insights could not be loaded."
        );
      } finally {
        window.clearTimeout(timeout);
        if (id === requestId.current) {
          setLoading(false);
          setWriting(false);
        }
      }
    },
    [accessToken, body, projectId]
  );

  // New filters or new data: recompute (free), after the filters settle.
  useEffect(() => {
    const timer = window.setTimeout(() => void load("auto"), 350);
    return () => window.clearTimeout(timer);
  }, [load, dataVersion]);

  const openPapers: OpenPapers = (paperIds, label) => onOpenPapers(paperIds, label);

  if (!projectId) {
    return (
      <section className="app-surface px-6 py-12 text-center text-sm text-slate-600 dark:text-[#a3a3a3]">
        Choose a repository to see its insights.
      </section>
    );
  }

  if (!result) {
    return (
      <section className="app-surface px-6 py-10" role="status" aria-live="polite">
        {error ? (
          <div className="text-center">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => void load("auto")}
              className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-800 hover:border-slate-300 dark:border-[#2a2a2a] dark:text-[#e5e5e5]"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <span className="skeleton block h-6 w-2/3 rounded" />
            <span className="skeleton block h-4 w-1/2 rounded" />
            <span className="skeleton mt-6 block h-48 w-full rounded-lg" />
            <p className="sr-only">Looking for patterns in the selected papers…</p>
          </div>
        )}
      </section>
    );
  }

  const { report, plan } = result;
  const byId = new Map(report.insights.map((insight) => [insight.id, insight]));
  const cards = plan.cards.filter((card) => byId.has(card.insightId));
  const shownIds = new Set(cards.map((card) => card.insightId));
  const more = report.insights.filter((insight) => !shownIds.has(insight.id));
  const written = plan.source === "model";
  const notices = [...report.notices, ...(result.notice ? [{ id: "few_papers" as const, text: result.notice }] : [])];

  return (
    <div className="space-y-5" aria-busy={loading || writing}>
      <section className="app-surface px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-[#8f8f8f]">
              <span>Insights</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                  written
                    ? "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                    : "bg-slate-100 text-slate-600 dark:bg-[#141414] dark:text-[#b3b3b3]"
                }`}
                title={written ? "A model chose and worded these; every number was checked against the computed data." : "Computed from the papers; no model was used."}
              >
                {written ? "Written by AI · numbers checked" : "Computed"}
              </span>
              {written && result.cached ? <span>Saved {timeAgo(plan.generatedAt)}</span> : null}
              {loading ? <SpinnerIcon className="h-3.5 w-3.5" /> : null}
            </p>
            <h2 className="mt-2 text-lg font-semibold leading-7 text-slate-900 dark:text-[#f2f2f2]">{plan.headline}</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-[#b3b3b3]">{plan.summary}</p>
            {plan.caveats.length ? (
              <ul className="mt-2 space-y-1 text-[13px] leading-5 text-slate-500 dark:text-[#999]">
                {plan.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {report.insights.length > 0 ? (
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <button
                type="button"
                onClick={() => void load("write", written)}
                disabled={writing || loading}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-[#e8e8e8]"
              >
                {writing ? <SpinnerIcon className="h-4 w-4" /> : <SparkIcon className="h-4 w-4" />}
                {writing ? "Writing…" : written ? "Rewrite with AI" : "Write up with AI"}
              </button>
              <p className="max-w-[16rem] text-xs leading-5 text-slate-500 dark:text-[#8f8f8f] sm:text-right">
                One short AI call. It can only use the numbers computed here.
              </p>
            </div>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">{error}</p> : null}
        {notices.length ? (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-[#1a1a1a]">
            <Notices notices={notices} />
          </div>
        ) : null}
      </section>

      {cards.length === 0 ? (
        <section className="app-surface flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-500 dark:border-[#2a2a2a] dark:text-[#a3a3a3]">
            <ChartIcon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">Nothing strong enough to show yet</h3>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
            A pattern needs at least 3 papers behind it and must hold when any one is removed. Widen the years or categories, or clear the search, to give it more to work with.
          </p>
        </section>
      ) : (
        cards.map((card, index) => (
          <InsightCard
            key={card.insightId}
            insight={byId.get(card.insightId)!}
            title={card.title}
            takeaway={card.takeaway}
            onOpen={openPapers}
            index={index}
          />
        ))
      )}

      {more.length > 0 ? (
        <section className="app-surface px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => setShowMore((value) => !value)}
            aria-expanded={showMore}
            className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-slate-800 dark:text-[#e5e5e5]"
          >
            <span>
              {more.length} more pattern{more.length === 1 ? "" : "s"} in these papers
            </span>
            <span className="text-xs text-slate-500 dark:text-[#8f8f8f]">{showMore ? "Hide" : "Show"}</span>
          </button>
          {showMore ? (
            <div className="mt-4 space-y-5">
              {more.map((insight, index) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  title={insight.question}
                  takeaway={insight.takeaway}
                  onOpen={openPapers}
                  index={cards.length + index}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

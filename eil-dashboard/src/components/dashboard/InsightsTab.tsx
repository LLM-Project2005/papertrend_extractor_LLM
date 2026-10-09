"use client";

/*
 * The Adaptive tab (docs/30): patterns in the selected papers that no fixed
 * tab shows, each with the numbers behind it.
 *
 * Opening the tab costs nothing: the insights are computed on the server, and a
 * write-up a model already made for exactly these papers comes from the cache.
 * "Write up with AI" makes one short model call that picks, orders and words
 * the insights; a checker holds every number it writes to the computed facts.
 * "Generate views" draws views these papers can answer for a reader who does
 * not know what to ask; neither it nor the example questions repeat a view
 * already shown (2026-10-10).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import InsightChart, { type OpenPapers } from "@/components/dashboard/InsightChart";
import ChartCsvButton from "@/components/tabs/ChartCsvButton";
import { insightCsv } from "@/lib/insights/csv";
import { ChartIcon, CloseIcon, RefreshIcon, SearchIcon, SparkIcon, SpinnerIcon, InfoIcon } from "@/components/ui/Icons";
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

const FAMILY: Record<Insight["family"], string> = {
  relationship: "What goes together",
  change: "What is changing",
  composition: "What the papers are",
  gap: "What stands apart",
};

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
    <section className="app-surface px-4 py-5 sm:px-6" aria-labelledby={`insight-${insight.id}-${index}`} data-insight={insight.id}>
      {index >= 0 ? (
        <p className="text-xs font-medium text-slate-500 dark:text-[#8f8f8f]">
          {index + 1} · {title === insight.question ? FAMILY[insight.family] : insight.question}
        </p>
      ) : null}
      <h3 id={`insight-${insight.id}-${index}`} className={`${index >= 0 ? "mt-1.5 " : ""}text-base font-semibold leading-6 text-slate-900 dark:text-white`}>
        {title}
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700 dark:text-[#d4d4d4]" data-takeaway>
        {takeaway}
      </p>
      {insight.caution ? (
        <p className="mt-2 flex max-w-3xl gap-2 text-[13px] leading-5 text-amber-900 dark:text-amber-200">
          <InfoIcon className="mt-0.5 h-4 w-4 flex-none" />
          <span>{insight.caution}</span>
        </p>
      ) : null}
      <div className="mt-5">
        <InsightChart insight={insight} onOpen={onOpen} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-[#1a1a1a]">
        <p className="max-w-2xl text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">{insight.basis}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ChartCsvButton csv={insightCsv(insight, title)} />
          <button
            type="button"
            onClick={() => onOpen(insight.paperIds, title)}
            className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#262626] dark:text-[#d4d4d4] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            The {insight.paperIds.length} paper{insight.paperIds.length === 1 ? "" : "s"} behind this
          </button>
        </div>
      </div>
    </section>
  );
}

interface AskEntry {
  id: number;
  question: string;
  insight?: Insight;
  unanswerable?: string;
  /** Drawn by "Generate views" rather than asked. */
  generated?: boolean;
}

/** An example question these papers can answer, with the view it stands for (insights/suggestions.ts). */
interface Suggestion {
  question: string;
  query: unknown;
  key: string;
  insight?: Insight;
}

const ANSWERS_KEPT = 6;

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
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AskEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateNote, setGenerateNote] = useState<string | null>(null);
  const requestId = useRef(0);
  const askId = useRef(0);
  // Every view already offered or drawn for this selection, so none comes back.
  const shownViews = useRef(new Set<string>());

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

  useEffect(() => {
    setAnswers([]);
    setAskError(null);
    setGenerateNote(null);
    shownViews.current = new Set();
  }, [body]);

  /** Views these papers can answer that this page has not shown yet; marks them shown. */
  const fetchViews = useCallback(
    async (count: number, run = false): Promise<{ views: Suggestion[]; exhausted: boolean }> => {
      if (!accessToken) return { views: [], exhausted: true };
      const response = await fetch("/api/workspace/insights/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ...body, exclude: [...shownViews.current], count, run }),
      });
      if (!response.ok) throw new Error("No new questions could be found just now.");
      const payload = (await response.json()) as { suggestions?: Suggestion[]; exhausted?: boolean };
      const views = payload.suggestions ?? [];
      views.forEach((view) => shownViews.current.add(view.key));
      return { views, exhausted: Boolean(payload.exhausted) };
    },
    [accessToken, body]
  );

  async function ask(event?: FormEvent<HTMLFormElement>, text = question, query?: unknown) {
    event?.preventDefault();
    const trimmed = text.trim();
    if (!projectId || !accessToken || trimmed.length < 3 || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const response = await fetch("/api/workspace/insights/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        // A suggested example sends its own view, which runs without a model call.
        body: JSON.stringify({ ...body, question: trimmed, ...(query === undefined ? {} : { query }) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { insight?: Insight; unanswerable?: string; error?: string };
      if (!response.ok || (!payload.insight && !payload.unanswerable)) {
        throw new Error(payload.error || "The question could not be answered just now.");
      }
      const id = (askId.current += 1);
      setAnswers((current) => [{ id, question: trimmed, insight: payload.insight, unanswerable: payload.unanswerable }, ...current].slice(0, ANSWERS_KEPT));
      setQuestion("");
    } catch (askFailure) {
      setAskError(askFailure instanceof Error ? askFailure.message : "The question could not be answered just now.");
    } finally {
      setAsking(false);
    }
  }

  // Example questions these papers can answer, for the current filters. Each
  // was checked against the papers on the server before it is offered.
  const enoughPapers = (result?.report.summary.papers ?? 0) >= 3;
  useEffect(() => {
    if (!projectId || !accessToken || !enoughPapers) return;
    let current = true;
    setSuggestions(null);
    const timer = window.setTimeout(() => {
      shownViews.current = new Set();
      void fetchViews(3)
        .then(({ views }) => {
          if (current) setSuggestions(views);
        })
        .catch(() => {
          if (current) setSuggestions([]);
        });
    }, 400);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [accessToken, body, enoughPapers, projectId, dataVersion, fetchViews]);

  /** Asks an example, and puts a question not shown before in its place. */
  function askSuggestion(suggestion: Suggestion) {
    setQuestion(suggestion.question);
    void ask(undefined, suggestion.question, suggestion.query);
    void fetchViews(1)
      .then(({ views }) =>
        setSuggestions((current) => {
          const list = current ?? [];
          const index = list.findIndex((item) => item.key === suggestion.key);
          const rest = list.filter((item) => item.key !== suggestion.key);
          if (views.length === 0) return rest;
          return index < 0 ? [...rest, ...views] : [...rest.slice(0, index), ...views, ...rest.slice(index)];
        })
      )
      .catch(() => setSuggestions((current) => (current ?? []).filter((item) => item.key !== suggestion.key)));
  }

  /** Three questions not shown before; once every view has been offered, the list starts again. */
  async function newSuggestions() {
    setRefreshing(true);
    try {
      let { views } = await fetchViews(3);
      if (views.length === 0) {
        shownViews.current = new Set();
        ({ views } = await fetchViews(3));
      }
      setSuggestions(views);
    } catch {
      // The current examples stay.
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * "Generate views": draws views these papers can answer, for a reader who does
   * not yet know what to ask. Each press brings views not shown before.
   */
  async function generate() {
    if (generating) return;
    setGenerating(true);
    setGenerateNote(null);
    try {
      let { views } = await fetchViews(3, true);
      let restarted = false;
      if (views.length === 0) {
        shownViews.current = new Set();
        ({ views } = await fetchViews(3, true));
        restarted = true;
      }
      const drawn = views.filter((view) => view.insight);
      if (drawn.length === 0) {
        setGenerateNote("These papers have no view to draw yet. Widen the years or research areas, or clear the search.");
        return;
      }
      if (restarted) setGenerateNote("Every view these papers can answer has been shown, so these start the list again.");
      setAnswers((current) =>
        [...drawn.map((view) => ({ id: (askId.current += 1), question: view.question, insight: view.insight, generated: true })), ...current].slice(0, ANSWERS_KEPT)
      );
    } catch {
      setGenerateNote("Nothing could be generated just now. Try again in a moment.");
    } finally {
      setGenerating(false);
    }
  }

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
          {report.summary.papers >= 3 || report.insights.length > 0 ? (
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {report.summary.papers >= 3 ? (
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={generating}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-[#e8e8e8]"
                  >
                    {generating ? <SpinnerIcon className="h-4 w-4" /> : <ChartIcon className="h-4 w-4" />}
                    {generating ? "Generating…" : "Generate views"}
                  </button>
                ) : null}
                {report.insights.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void load("write", written)}
                    disabled={writing || loading}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#2a2a2a] dark:text-[#e5e5e5] dark:hover:border-[#3a3a3a] dark:hover:text-white"
                  >
                    {writing ? <SpinnerIcon className="h-4 w-4" /> : <SparkIcon className="h-4 w-4" />}
                    {writing ? "Writing…" : written ? "Rewrite with AI" : "Write up with AI"}
                  </button>
                ) : null}
              </div>
              <p className="max-w-[20rem] text-xs leading-5 text-slate-500 dark:text-[#8f8f8f] sm:text-right">
                {report.summary.papers >= 3
                  ? "Generate draws three views these papers can answer, new each time. AI only words them; the numbers are computed here."
                  : "One short AI call. It can only use the numbers computed here."}
              </p>
            </div>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">{error}</p> : null}
        {generateNote ? (
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#b8b8b8]" role="status">
            {generateNote}
          </p>
        ) : null}
        {notices.length ? (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-[#1a1a1a]">
            <Notices notices={notices} />
          </div>
        ) : null}
      </section>

      {report.summary.papers >= 3 ? (
        <section className="app-surface px-4 py-4 sm:px-6" aria-label="Ask about these papers">
          <form onSubmit={(event) => void ask(event)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="insights-ask" className="sr-only">
              Ask about these papers
            </label>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#737373]" />
              <input
                id="insights-ask"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={300}
                placeholder="Ask about these papers, e.g. which methods are used for which themes?"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-400 focus:outline-none dark:border-[#262626] dark:bg-[#050505] dark:text-[#f2f2f2] dark:placeholder:text-[#8f8f8f] dark:focus:border-[#4a4a4a]"
              />
            </div>
            <button
              type="submit"
              disabled={asking || question.trim().length < 3}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-800 transition-colors hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#2a2a2a] dark:text-[#e5e5e5] dark:hover:border-[#3a3a3a] dark:hover:text-white"
            >
              {asking ? <SpinnerIcon className="h-4 w-4" /> : null}
              {asking ? "Working it out…" : "Ask"}
            </button>
          </form>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">
            One short AI call turns the question into a view; the numbers are computed from the papers.{" "}
          </p>
          {suggestions === null ? (
            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">Finding questions these papers can answer…</p>
          ) : suggestions.length > 0 ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">Questions these papers can answer:</p>
                <button
                  type="button"
                  onClick={() => void newSuggestions()}
                  disabled={refreshing}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#b3b3b3] dark:hover:bg-[#141414] dark:hover:text-white"
                >
                  {refreshing ? <SpinnerIcon className="h-3.5 w-3.5" /> : <RefreshIcon className="h-3.5 w-3.5" />}
                  Other questions
                </button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2" aria-live="polite">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.key}>
                    <button
                      type="button"
                      onClick={() => askSuggestion(suggestion)}
                      disabled={asking}
                      className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3.5 text-left text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#2a2a2a] dark:bg-[#050505] dark:text-[#d4d4d4] dark:hover:border-[#4a4a4a] dark:hover:text-white"
                    >
                      {suggestion.question}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {askError ? <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-300" role="alert">{askError}</p> : null}
        </section>
      ) : null}

      {answers.map((answer) => (
        <div key={answer.id} className="relative">
          <p className="mb-2 flex items-center justify-between gap-3 px-1 text-sm text-slate-600 dark:text-[#b3b3b3]">
            <span>
              {answer.generated ? "Generated: " : "You asked: "}
              <span className="font-medium text-slate-900 dark:text-white">{answer.question}</span>
            </span>
            <button
              type="button"
              onClick={() => setAnswers((current) => current.filter((entry) => entry.id !== answer.id))}
              aria-label="Remove this answer"
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#141414] dark:hover:text-white"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </p>
          {answer.insight ? (
            <InsightCard insight={answer.insight} title={answer.insight.question} takeaway={answer.insight.takeaway} onOpen={openPapers} index={-1} />
          ) : (
            <section className="app-surface px-4 py-4 text-sm leading-6 text-slate-700 dark:text-[#d4d4d4] sm:px-6">{answer.unanswerable}</section>
          )}
        </div>
      ))}

      {cards.length === 0 ? (
        <section className="app-surface flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-500 dark:border-[#2a2a2a] dark:text-[#a3a3a3]">
            <ChartIcon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">Nothing strong enough to show yet</h3>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
            A pattern needs at least 3 papers behind it and must hold when any one is removed. Widen the years or research areas, or clear the search, to give it more to work with.
          </p>
          {report.summary.papers >= 3 && answers.length === 0 ? (
            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
              Smaller questions still have answers: <strong className="font-semibold text-slate-900 dark:text-white">Generate views</strong> above draws three of them.
            </p>
          ) : null}
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

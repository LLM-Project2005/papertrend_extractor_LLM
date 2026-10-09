"use client";

/*
 * Max effort's thinking, in the conversation (2026-10-10: "make the deep
 * thinking's thinking UI blend in, not a whole canvas like deep research; this
 * is not deep research anymore"). While it works, one line says what it is
 * doing and for how long; once it has answered, one line above the answer says
 * how long it thought and what it checked. The steps are a click away in both.
 * It replaces the research card - a title, chips, a progress bar and a report -
 * for runs of the research engine (v2); older runs keep their card.
 */
import { useEffect, useState } from "react";
import ThinkingOrb from "@/components/ui/ThinkingOrb";
import { ChevronDownIcon } from "@/components/ui/Icons";
import type { DeepResearchSessionRecord, DeepResearchStepRecord } from "@/types/research";

const RUNNING: ReadonlySet<DeepResearchSessionRecord["status"]> = new Set(["planned", "queued", "waiting_on_analysis", "processing"]);

export function thinkingIsRunning(session: DeepResearchSessionRecord | null | undefined): boolean {
  return Boolean(session && RUNNING.has(session.status));
}

/** "42s", "1m 20s". */
export function thinkingDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** What the run is doing now, in a few words. */
export function thinkingNow(session: DeepResearchSessionRecord): string {
  if (session.status === "planned" || session.status === "queued") return "Working out how to answer";
  if (session.status === "waiting_on_analysis") {
    return session.pending_run_count > 0
      ? `Waiting for ${session.pending_run_count} paper${session.pending_run_count === 1 ? "" : "s"} to finish analysis`
      : "Waiting for analysis to finish";
  }
  const active = (session.steps ?? []).find((step) => step.status === "processing");
  return active?.title?.trim() || "Thinking it through";
}

function visibleSteps(steps: DeepResearchStepRecord[] | undefined): DeepResearchStepRecord[] {
  return (steps ?? []).filter((step) => step.output_payload?.result_kind !== "obsolete");
}

export function ThinkingSteps({ steps }: { steps: DeepResearchStepRecord[] }) {
  return (
    <ol className="mt-3 space-y-2.5 border-l border-slate-200 pl-4 dark:border-[#262626]">
      {steps.map((step) => {
        const done = step.status === "completed";
        const working = step.status === "processing";
        const failed = step.status === "failed";
        const summary = step.output_payload?.summary?.trim() || step.description?.trim() || "";
        return (
          <li key={step.id} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-[21px] top-2 h-2 w-2 rounded-full ${
                done
                  ? "bg-slate-900 dark:bg-white"
                  : working
                    ? "animate-pulse bg-slate-500 dark:bg-[#a3a3a3]"
                    : failed
                      ? "bg-red-600 dark:bg-red-400"
                      : "border border-slate-400 bg-transparent dark:border-[#666]"
              }`}
            />
            <p className="text-[13px] font-medium leading-6 text-slate-800 dark:text-[#e5e5e5]">
              {step.title}
              <span className="sr-only">{done ? " (done)" : working ? " (in progress)" : failed ? " (failed)" : " (to do)"}</span>
            </p>
            {summary ? <p className="line-clamp-2 text-xs leading-5 text-slate-600 dark:text-[#a3a3a3]">{summary}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A Max run that has not answered yet: thinking, or stopped. `onStop` ends it,
 * `onRetry` resumes a stopped one, `onEdit` puts the question back in the box.
 */
export function ThinkingLive({
  session,
  onStop,
  onRetry,
  onEdit,
  busy = false,
}: {
  session: DeepResearchSessionRecord;
  onStop?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  busy?: boolean;
}) {
  const running = RUNNING.has(session.status);
  const failed = session.status === "failed";
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const started = Date.parse(session.created_at ?? "");
  const steps = visibleSteps(session.steps);

  return (
    <section aria-label="Thinking" className="flex items-start gap-3" data-testid="thinking-live">
      <ThinkingOrb size={20} state={running ? "working" : "breathing"} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
          {running ? (
            <>
              <span className="thinking-shimmer font-medium text-slate-800 dark:text-[#e5e5e5]">Thinking</span>
              <span className="text-slate-600 dark:text-[#a3a3a3]" aria-live="polite">
                {thinkingNow(session)}
              </span>
              {Number.isFinite(started) ? (
                <span className="text-xs tabular-nums text-slate-600 dark:text-[#a3a3a3]">{thinkingDuration(now - started)}</span>
              ) : null}
            </>
          ) : (
            <span className="font-medium text-slate-800 dark:text-[#e5e5e5]">{failed ? "The thinking stopped before an answer" : "Stopped before an answer"}</span>
          )}
          {steps.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
              className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-slate-600 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70 dark:text-[#a3a3a3] dark:hover:text-white"
            >
              <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
              {open ? "Hide steps" : `Show steps (${steps.length})`}
            </button>
          ) : null}
          {running && onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-md text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-slate-950 dark:text-[#a3a3a3] dark:decoration-[#444] dark:hover:text-white"
            >
              Stop
            </button>
          ) : null}
          {!running && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={busy}
              className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-[#111111] dark:hover:bg-[#e8e8e8]"
            >
              {failed ? "Try again" : "Resume"}
            </button>
          ) : null}
          {!running && onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-slate-950 dark:text-[#a3a3a3] dark:decoration-[#444] dark:hover:text-white"
            >
              Edit the question
            </button>
          ) : null}
        </div>
        {!running && session.last_error ? (
          <p className="mt-1 text-xs leading-5 text-red-700 dark:text-red-300">{session.last_error}</p>
        ) : null}
        {open ? <ThinkingSteps steps={steps} /> : null}
      </div>
    </section>
  );
}

interface ThoughtMetadata {
  durationMs?: unknown;
  questions?: unknown;
  papersSearched?: unknown;
  audit?: unknown;
  auditRan?: unknown;
}

/** "Thought for 42s · 3 parts · 7 papers read · 32 claims checked", from a Max answer's record. */
export function thoughtLine(metadata: ThoughtMetadata | null | undefined): string {
  const parts: string[] = [];
  const duration = Number(metadata?.durationMs);
  parts.push(Number.isFinite(duration) && duration > 0 ? `Thought for ${thinkingDuration(duration)}` : "Thought it through");
  const questions = Array.isArray(metadata?.questions) ? metadata.questions.length : 0;
  if (questions > 1) parts.push(`${questions} parts`);
  const papers = Number(metadata?.papersSearched);
  if (Number.isFinite(papers) && papers > 0) parts.push(`${papers} paper${papers === 1 ? "" : "s"} read`);
  const audit = metadata?.audit && typeof metadata.audit === "object" ? (metadata.audit as { checked?: unknown }) : null;
  const checked = Number(audit?.checked);
  if (metadata?.auditRan && Number.isFinite(checked) && checked > 0) parts.push(`${checked} claim${checked === 1 ? "" : "s"} checked`);
  return parts.join(" · ");
}

/** The line above a Max answer; the steps unfold from it when this page has them. */
export function ThoughtSummary({ metadata, steps }: { metadata: ThoughtMetadata | null | undefined; steps?: DeepResearchStepRecord[] }) {
  const [open, setOpen] = useState(false);
  const shown = visibleSteps(steps);
  const line = thoughtLine(metadata);
  if (shown.length === 0) {
    return <p className="text-xs font-medium text-slate-600 dark:text-[#a3a3a3]">{line}</p>;
  }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-slate-600 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70 dark:text-[#a3a3a3] dark:hover:text-white"
      >
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        {line}
      </button>
      {open ? <ThinkingSteps steps={shown} /> : null}
    </div>
  );
}

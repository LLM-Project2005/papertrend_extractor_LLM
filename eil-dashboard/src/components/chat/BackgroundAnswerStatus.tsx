"use client";

import { useEffect, useState } from "react";
import ThinkingOrb from "@/components/ui/ThinkingOrb";
import { ChevronDownIcon } from "@/components/ui/Icons";
import { ThinkingSteps, thinkingDuration } from "@/components/chat/ThinkingTrace";
import type { DeepResearchStepRecord } from "@/types/research";

/*
 * What a background answer is doing, in place of one fixed sentence. A long
 * request (a whole-repository overview, more than 80 papers, web search) runs
 * as a job; the job saves each step it reaches and the conversation polls it.
 * It is drawn as Max's thinking line (ThinkingTrace.tsx) so the two read the
 * same: the orb, "Thinking", the step in progress, the time, and the steps a
 * click away.
 */

export interface BackgroundAnswerStep {
  stage: string;
  label: string;
  detail?: string;
}

export function waitingLabel(status: string | undefined): string {
  return status === "queued" ? "Waiting for a free worker" : "Starting";
}

/** The job's steps in the shape Max's step list draws: all done but the last. */
export function asThinkingSteps(steps: BackgroundAnswerStep[]): DeepResearchStepRecord[] {
  return steps.map((step, index) => ({
    id: `background-step-${index}`,
    session_id: "background",
    position: index,
    title: step.label,
    description: step.detail ?? null,
    status: index === steps.length - 1 ? "processing" : "completed",
  }));
}

export default function BackgroundAnswerStatus({
  status,
  steps,
  startedAt,
}: {
  status?: string;
  steps: BackgroundAnswerStep[];
  /** When the job was made, if known; otherwise the time this was first shown. */
  startedAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parsedStart = startedAt ? Date.parse(startedAt) : Number.NaN;
  const start = Number.isFinite(parsedStart) ? Math.min(parsedStart, shownAt) : shownAt;
  const current = steps[steps.length - 1];
  const doing = current
    ? `${current.label}${current.detail ? ` · ${current.detail}` : ""}`
    : waitingLabel(status);

  return (
    <section aria-label="Thinking" className="flex items-start gap-3" data-testid="background-answer-status">
      <ThinkingOrb size={20} state={status === "queued" && !current ? "breathing" : "working"} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
          <span className="thinking-shimmer font-medium text-ink">Thinking</span>
          <span className="text-body" aria-live="polite">
            {/* Keyed on the words, so each new step slides in. */}
            <span key={doing} className="status-swap inline-block">{doing}</span>
          </span>
          <span className="text-xs tabular-nums text-body">{thinkingDuration(now - start)}</span>
          {steps.length > 1 ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-body transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70"
            >
              <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
              {open ? "Hide steps" : `Show steps (${steps.length})`}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-body">
          This one runs in the background. You can leave the page; the answer will appear here.
        </p>
        {open ? <ThinkingSteps steps={asThinkingSteps(steps)} /> : null}
      </div>
    </section>
  );
}

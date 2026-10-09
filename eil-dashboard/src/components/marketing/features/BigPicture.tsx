"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STAGE_STATUS, TOPIC_STAGES } from "@/components/marketing/how-it-works-content";
import { useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";
import { ChartIcon, ChatIcon, DatabaseIcon, PaperIcon, RefreshIcon } from "@/components/ui/Icons";

/*
 * The whole system on one line: PDFs go in, each is read in stages, the
 * repository keeps what was read, and the dashboard and chat work from it.
 * When the figure is seen, the stages light one after another while pulses
 * travel the connectors; then everything rests, with a button to run it
 * again. Under reduced motion it is the finished state.
 */

// Step 0 waits, steps 1-6 are the stages, step 7 is done (and stays).
const DURATIONS = [500, ...TOPIC_STAGES.map(() => 1150), 99999];
const DONE = DURATIONS.length - 1;

function Connector({ on }: { on: boolean }) {
  return (
    <div aria-hidden="true" className="flow-line mx-auto h-8 w-px flex-none bg-hairline-strong lg:mx-1 lg:h-px lg:w-11 lg:self-center" data-on={on}>
      <i />
      <i />
      <i />
    </div>
  );
}

export default function BigPicture() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.35 });
  const [started, setStarted] = useState(false);
  const [step, setStep] = useSequence(DURATIONS, started && motionOK, false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (onScreen && motionOK) setStarted(true);
  }, [onScreen, motionOK]);

  const shown = motionOK ? step : DONE;
  const running = started && shown < DONE;
  const current = Math.min(Math.max(shown - 1, 0), TOPIC_STAGES.length - 1);
  const stage = TOPIC_STAGES[current];

  return (
    <div ref={ref} className="relative">
      <div className="rounded-[20px] border border-hairline bg-surface p-5 text-left shadow-float sm:p-7">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[12px] uppercase tracking-[0.04em] text-mute">The big picture</p>
          <ul className="flex flex-wrap gap-1.5 font-mono text-[11px] text-mute">
            {["Cloud Run", "Cloud SQL", "Cloud Tasks", "OpenRouter"].map((name) => (
              <li key={name} className="rounded-md border border-hairline px-2 py-0.5">
                {name}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-stretch">
          {/* In */}
          <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-hairline bg-canvas p-4 lg:flex-1">
            <div className="flex h-6 items-center justify-between" aria-hidden="true">
              <span key={run} className="flex text-mute">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className={`-mr-1.5 ${index === 1 ? "text-accent-ink" : ""} ${started && motionOK ? "enter-fly" : ""}`}
                    style={{ animationDelay: `${0.15 + index * 0.25}s` }}
                  >
                    <PaperIcon className="h-5 w-5" />
                  </span>
                ))}
              </span>
              <span className="rounded border border-hairline px-1.5 font-mono text-[10px] text-mute">EN · TH</span>
            </div>
            <p className="text-[15px] font-medium text-ink">Your PDFs</p>
            <p className="text-[13px] leading-5 text-body">English or Thai, from your computer or Google Drive.</p>
          </div>

          <Connector on={running} />

          {/* The analysis */}
          <div className="glow-ring min-w-0 rounded-[14px] lg:flex-[1.45]" data-on={running}>
            <div className="flex h-full flex-col gap-3 rounded-[12.5px] bg-surface p-4">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="flex items-center gap-2 uppercase text-accent-ink">
                  {running ? <span className="live-dot" aria-hidden="true" /> : null}
                  Analysis
                </span>
                <span className="tabular-nums text-mute">
                  {shown >= DONE ? "done" : `stage ${current + 1} of ${TOPIC_STAGES.length}`}
                </span>
              </div>
              <p className="text-[15px] font-medium text-ink">Each paper, read in stages</p>
              <ul className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                {TOPIC_STAGES.map((item, index) => {
                  const state = shown >= DONE || index < current ? "done" : index === current && shown >= 1 ? "on" : "next";
                  return (
                    <li
                      key={item.key}
                      className={`rounded-md px-2 py-0.5 transition-[background-color,color,transform] duration-300 ${
                        state === "on" ? "-translate-y-px bg-ink text-canvas" : state === "done" ? "bg-subtle text-ink" : "bg-subtle text-mute"
                      }`}
                    >
                      {item.name.toLowerCase()}
                    </li>
                  );
                })}
              </ul>
              <p className="truncate rounded-md border border-hairline bg-canvas px-2.5 py-1.5 font-mono text-[11.5px] text-body">
                <span className="text-accent-ink">›</span>{" "}
                {shown >= DONE ? "dashboard and chat updated" : `${stage.name.toLowerCase()} → ${STAGE_STATUS[stage.key]}`}
              </p>
            </div>
          </div>

          <Connector on={running} />

          {/* What is kept */}
          <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-hairline bg-canvas p-4 lg:flex-1">
            <DatabaseIcon className="h-5 w-5 text-mute" />
            <p className="text-[15px] font-medium text-ink">Your repository</p>
            <div className="space-y-1.5" aria-hidden="true">
              {[92, 74, 86].map((width, index) => (
                <span key={index} className="block h-1.5 overflow-hidden rounded-full bg-subtle">
                  <span
                    className={`block h-full rounded-full transition-[width] duration-700 ease-out-expo ${index === 2 ? "bg-[rgb(234_179_8)]" : "bg-accent"}`}
                    style={{ width: shown >= 3 + index ? `${width}%` : "0%" }}
                  />
                </span>
              ))}
            </div>
            <p className="text-[13px] leading-5 text-body">Each paper’s record with the sentences behind it, and a search index of its passages.</p>
          </div>

          <Connector on={running} />

          {/* Out */}
          <div className="flex min-w-0 flex-col gap-2.5 lg:flex-[1.1]">
            <Link
              href="/features/research-dashboard"
              className="group flex flex-1 items-start gap-3 rounded-xl border border-hairline bg-surface px-4 py-3.5 transition-colors hover:border-hairline-strong"
            >
              <ChartIcon className="mt-0.5 h-5 w-5 flex-none text-accent-ink" />
              <span>
                <span className="block text-[14px] font-medium text-ink">Dashboard</span>
                <span className="block text-[13px] leading-5 text-body">Themes, categories and keywords over time</span>
              </span>
            </Link>
            <Link
              href="#chat"
              className="group flex flex-1 items-start gap-3 rounded-xl border border-hairline bg-surface px-4 py-3.5 transition-colors hover:border-hairline-strong"
            >
              <ChatIcon className="mt-0.5 h-5 w-5 flex-none text-accent-ink" />
              <span>
                <span className="block text-[14px] font-medium text-ink">Research chat</span>
                <span className="block text-[13px] leading-5 text-body">Answers with a source on every claim</span>
              </span>
            </Link>
          </div>
        </div>
      </div>

      {shown >= DONE && motionOK ? (
        <button
          type="button"
          onClick={() => {
            setRun((value) => value + 1);
            setStep(0);
          }}
          className="absolute -bottom-11 right-1 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          Run it again
        </button>
      ) : null}
      <p className="sr-only">
        Your PDFs are read in six stages: read, find, group, name, check and agree. Your repository keeps each paper’s record and a
        search index, which the dashboard and research chat work from.
      </p>
    </div>
  );
}

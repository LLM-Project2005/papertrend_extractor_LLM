"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { CheckCircleIcon, CloudIcon, FilePdfIcon, RefreshIcon } from "@/components/ui/Icons";

/*
 * The progress tray (AnalysisStatusCard), acted out: five PDFs dropped in,
 * one already in the library and stopped before it uploads, the rest moving
 * through the ten named steps one paper at a time. "Close this tab" shows the
 * point of a queue in the cloud: the work goes on without the page, and the
 * tray picks up where it was.
 *
 * Under reduced motion it shows the finished batch.
 */

const STEPS = ["Upload", "Queued", "Prepare", "Read text", "Sections", "Metadata", "Keywords", "Classify", "Save", "Done"];
const DONE = STEPS.length - 1;
const FILES = ["mangroves-and-seawalls-semarang.pdf", "managed-retreat-bangkok.pdf", "storm-surge-chittagong.pdf", "heat-islands-durban.pdf"];
const DUPLICATE = "mangroves-and-seawalls-semarang (1).pdf";

/** Each file's step after `tick` ticks: all upload, then one at a time through the rest. */
function stepsAt(tick: number): number[] {
  const uploaded = tick >= 2;
  let remaining = Math.max(0, tick - 2);
  return FILES.map(() => {
    if (!uploaded) return 0;
    const run = Math.min(remaining, DONE - 1);
    remaining -= run;
    return 1 + run;
  });
}

const LAST_TICK = 2 + FILES.length * (DONE - 1);

export default function QueueTray() {
  const id = useId();
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.4 });
  const [tick, setTick] = useState(0);
  const [closed, setClosed] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!motionOK) {
      setTick(LAST_TICK);
      return;
    }
    if (!onScreen || tick >= LAST_TICK) return;
    const timer = window.setTimeout(() => {
      setTick((value) => value + 1);
      setSeconds(0);
    }, closed ? 260 : 620);
    return () => window.clearTimeout(timer);
  }, [onScreen, tick, closed, motionOK]);

  useEffect(() => {
    if (!motionOK || !onScreen || tick >= LAST_TICK) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [motionOK, onScreen, tick]);

  const steps = stepsAt(tick);
  const finished = steps.filter((step) => step === DONE).length;
  const all = tick >= LAST_TICK;

  return (
    <div ref={ref} className="relative">
      <div className="mb-4 flex items-center justify-end gap-3">
        <label htmlFor={`${id}-closed`} className="text-[13px] text-body">
          Close this tab
        </label>
        <button
          id={`${id}-closed`}
          type="button"
          role="switch"
          aria-checked={closed}
          onClick={() => setClosed((value) => !value)}
          className={`relative h-6 w-11 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${closed ? "bg-ink" : "bg-hairline-strong"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-raise transition-transform duration-200 ease-out-expo ${closed ? "translate-x-[22px]" : "translate-x-0.5"}`} />
        </button>
      </div>

      <div className="relative overflow-hidden rounded-[22px] border border-hairline bg-surface shadow-float">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <p className="text-[14px] font-medium text-ink" aria-live="polite">
            {all ? `${FILES.length} papers analysed` : `Analysing ${FILES.length} papers · ${finished} done`}
          </p>
          <span className="text-[12.5px] text-mute">{all ? "Dismiss" : "Cancel all"}</span>
        </div>

        <ul className="divide-y divide-hairline">
          <li className="flex items-center gap-3 bg-subtle/50 px-5 py-3 text-[13px]">
            <FilePdfIcon className="h-4 w-4 flex-none text-mute" />
            <span className="min-w-0 flex-1 truncate text-mute line-through">{DUPLICATE}</span>
            <span className="flex-none text-[12px] text-body">Already in your library, not uploaded</span>
          </li>
          {FILES.map((file, index) => {
            const step = steps[index];
            const active = step > 1 && step < DONE;
            return (
              <li key={file} className="px-5 py-3.5">
                <div className="flex items-center gap-3 text-[13.5px]">
                  {step === DONE ? (
                    <CheckCircleIcon className="h-4 w-4 flex-none text-ink" />
                  ) : (
                    <FilePdfIcon className={`h-4 w-4 flex-none ${active ? "text-ink" : "text-mute"}`} />
                  )}
                  <span className={`min-w-0 flex-1 truncate ${step === DONE || active ? "text-ink" : "text-body"}`}>{file}</span>
                  <span className="flex-none font-mono text-[11.5px] tabular-nums text-mute">
                    {step === DONE ? "Ready" : `${STEPS[step]} · ${step + 1}/10${active ? ` · ${seconds}s` : ""}`}
                  </span>
                </div>
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-subtle">
                  <motion.span
                    className={`block h-full rounded-full ${step === DONE ? "bg-ink/50" : "bg-ink"}`}
                    initial={false}
                    animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                    transition={{ duration: motionOK ? 0.5 : 0, ease: EASE }}
                  />
                </span>
              </li>
            );
          })}
        </ul>

        <AnimatePresence>
          {closed ? (
            <motion.div
              key="closed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/85 px-6 text-center backdrop-blur-[3px]"
            >
              <CloudIcon className="h-8 w-8 text-ink" />
              <p className="text-[15px] font-medium text-ink">The tab is closed. The analysis is not.</p>
              <p className="max-w-xs text-[13.5px] leading-6 text-body">
                Your papers are already in the cloud, queued and being read. Turn the switch off to come back to the tray.
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {all && motionOK ? (
        <button
          type="button"
          onClick={() => {
            setTick(0);
            setClosed(false);
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshIcon className="h-3.5 w-3.5" /> Drop them in again
        </button>
      ) : null}
    </div>
  );
}

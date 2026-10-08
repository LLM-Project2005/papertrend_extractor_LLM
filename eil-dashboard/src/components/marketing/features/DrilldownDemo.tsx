"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DEMO_PAPERS_BY_YEAR, DEMO_YEARS } from "@/components/marketing/demo-data";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { ArrowRightIcon, ChatIcon, CopyIcon, PaperIcon, SendIcon } from "@/components/ui/Icons";

/*
 * The dashboard's drilldown (DashboardClient): any bar opens the papers behind
 * it, and "Ask in chat" carries those papers into a new question with the
 * prompt the product writes for you. Here the bars are real buttons; the demo
 * picks the tallest one by itself once, then it is the reader's.
 */

const prompt = (count: number, year: number) => `Summarise what these ${count} papers (${year}) find, and how they differ.`;

export default function DrilldownDemo() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.45 });
  const [year, setYear] = useState<number | null>(null);
  const [asked, setAsked] = useState(false);
  const [typed, setTyped] = useState(0);
  const max = Math.max(...DEMO_YEARS.map((item) => item.papers));
  const papers = year ? DEMO_PAPERS_BY_YEAR[year] ?? [] : [];
  const text = year ? prompt(papers.length, year) : "";

  useEffect(() => {
    if (!motionOK) {
      setYear(2022);
      return;
    }
    if (!onScreen) return;
    const timer = window.setTimeout(() => setYear((current) => current ?? 2022), 900);
    return () => window.clearTimeout(timer);
  }, [onScreen, motionOK]);

  useEffect(() => {
    if (!asked) return;
    if (!motionOK) {
      setTyped(text.length);
      return;
    }
    setTyped(0);
    const timer = window.setInterval(() => setTyped((count) => (count >= text.length ? count : count + 2)), 24);
    return () => window.clearInterval(timer);
  }, [asked, text, motionOK]);

  return (
    <div ref={ref} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <figure className="rounded-[22px] border border-hairline bg-surface p-5 sm:p-6">
        <figcaption className="text-[14px] font-medium text-ink">Papers per year</figcaption>
        <p className="mt-0.5 text-[12.5px] text-mute">Choose a bar.</p>
        <div className="mt-6 flex h-52 items-end gap-1 sm:gap-1.5">
          {DEMO_YEARS.map((item) => {
            const on = item.year === year;
            return (
              <button
                key={item.year}
                type="button"
                disabled={item.papers === 0}
                aria-pressed={on}
                aria-label={`${item.year}: ${item.papers} ${item.papers === 1 ? "paper" : "papers"}`}
                onClick={() => {
                  setYear(item.year);
                  setAsked(false);
                }}
                className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
              >
                <span className={`font-mono text-[10.5px] tabular-nums transition-opacity ${on ? "text-ink opacity-100" : "text-mute opacity-0 group-hover:opacity-100"}`}>
                  {item.papers || ""}
                </span>
                <span
                  className={`block w-full rounded-t-[4px] transition-colors duration-200 ${on ? "bg-ink" : "bg-ink/20 group-hover:bg-ink/40 group-disabled:bg-transparent"}`}
                  style={{ height: `${(item.papers / max) * 82}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10.5px] tabular-nums text-mute" aria-hidden="true">
          <span>2011</span>
          <span>2025</span>
        </div>
      </figure>

      <div className="relative min-h-[320px] overflow-hidden rounded-[22px] border border-hairline bg-surface" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {!year ? (
            <motion.p key="empty" exit={{ opacity: 0 }} className="flex h-full min-h-[320px] items-center justify-center px-8 text-center text-[14px] text-mute">
              The papers behind a bar appear here.
            </motion.p>
          ) : !asked ? (
            <motion.div
              key={`list-${year}`}
              initial={motionOK ? { opacity: 0, x: 16 } : false}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex h-full flex-col p-5 sm:p-6"
            >
              <p className="text-[14px] font-medium text-ink">
                {year} · {papers.length} {papers.length === 1 ? "paper" : "papers"}
              </p>
              <ul className="mt-4 max-h-[188px] flex-1 space-y-1 overflow-y-auto pr-1">
                {papers.map((title) => (
                  <li key={title} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] leading-5 text-body">
                    <PaperIcon className="mt-0.5 h-4 w-4 flex-none text-mute" />
                    {title}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[13px] text-body">
                  <CopyIcon className="h-3.5 w-3.5" /> Copy list
                </span>
                <button
                  type="button"
                  onClick={() => setAsked(true)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-canvas transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ChatIcon className="h-3.5 w-3.5" /> Ask in chat
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`chat-${year}`}
              initial={motionOK ? { opacity: 0, x: 16 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex h-full min-h-[320px] flex-col justify-end p-5 sm:p-6"
            >
              <p className="text-[12.5px] text-mute">A new chat, scoped to the papers you chose</p>
              <div className="mt-3 rounded-2xl border border-hairline-strong bg-canvas p-4 shadow-raise dark:bg-black/40">
                <p className="text-[12px] text-mute">
                  Searching {papers.length} selected {papers.length === 1 ? "paper" : "papers"} · from the {year} bar
                </p>
                <p className="mt-2 min-h-[48px] text-[14.5px] leading-6 text-ink">
                  {text.slice(0, typed)}
                  {typed < text.length ? <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-ink motion-safe:animate-pulse" /> : null}
                </p>
                <div className="mt-2 flex justify-end">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-canvas">
                    <SendIcon className="h-4 w-4" />
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAsked(false)}
                className="mt-4 self-start rounded-full px-1 py-1 text-[13px] text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Back to the papers
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

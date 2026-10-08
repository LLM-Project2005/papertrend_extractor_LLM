"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ComponentType } from "react";
import UnderTheHood from "@/components/marketing/kit/UnderTheHood";
import { EASE, useMotionOK } from "@/components/marketing/kit/motion";
import {
  ChatIcon,
  CheckCircleIcon,
  FilterIcon,
  PencilSquareIcon,
  QuestionIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "@/components/ui/Icons";

/*
 * What happens between pressing Enter and reading the answer, one stage at a
 * time (src/lib/repository-chat.ts; docs/33). The plain account is always on
 * the page; the model, the numbers and the method sit under each stage's
 * "Under the hood".
 *
 * On a wide screen a diagram stays in view beside the stages and lights the
 * one being read, found by which stage crosses the middle of the screen
 * (IntersectionObserver, no scroll listener). On a phone each stage carries
 * its own icon instead.
 */

type Icon = ComponentType<{ className?: string }>;

const STEPS: Array<{ short: string; title: string; body: string; hood: string; Icon: Icon }> = [
  {
    short: "Understand",
    title: "It works out what you are asking",
    body:
      "A planner reads your question, and the conversation before it, and decides what the job is: list papers, compare them, look for evidence, or read the whole repository. It also notes whether you asked in English or Thai.",
    hood:
      "GPT-6 Luna, asked to reason briefly, returns one to four operations in a few seconds. If its plan cannot be used after one repair, plain keyword rules take over. Questions about citation counts or impact factors are pointed to Scopus, Web of Science or Google Scholar: those numbers are not in your PDFs.",
    Icon: ChatIcon,
  },
  {
    short: "Search",
    title: "It searches by words and by meaning",
    body:
      "Every paper is searched twice at once: for the words you used, and for passages that mean the same thing in other words. A paper about “inundation” still answers a question about flooding.",
    hood:
      "Keyword ranking scores titles, abstracts, methods, results, conclusions, topics and keywords. Meaning search compares your question with 2,800-character passages embedded by OpenAI’s text-embedding-3-small and stored in Postgres with pgvector. The rankings are merged by reciprocal-rank fusion.",
    Icon: SearchIcon,
  },
  {
    short: "Choose",
    title: "It chooses the strongest papers",
    body:
      "The best candidates are read side by side and the ones that bear on your question are kept. A question about a handful of studies gets those studies, not forty loosely related ones.",
    hood: "48 candidates, 24 read closely by GPT-6 Luna, up to 10 papers chosen. If that step fails, the merged ranking stands.",
    Icon: FilterIcon,
  },
  {
    short: "Enough?",
    title: "It asks whether that is enough",
    body:
      "Before writing a word, it checks the chosen passages against the question. If something is missing, it searches again with new phrasing and widens the reading.",
    hood: "A sufficiency check on GPT-6 Luna. Up to four follow-up searches; the selection can grow to 20 papers. Skipped when every paper in scope is already chosen.",
    Icon: QuestionIcon,
  },
  {
    short: "Write",
    title: "It writes only from those passages",
    body:
      "The answer is written from the selected passages and nothing else, in the language you asked in, with a numbered source on every claim. Text inside a paper is treated as material to read, never as an instruction to follow.",
    hood:
      "GPT-6 Luna writes; code then confirms every citation points to a paper that was actually read. A citation to anything else is removed.",
    Icon: PencilSquareIcon,
  },
  {
    short: "Check",
    title: "It checks the draft before you see it",
    body:
      "A draft whose support is in any doubt is read again beside its sources. A claim that says more than its source is corrected or removed, and the answer tells you what could not be checked.",
    hood:
      "The audit asks four things: is each claim supported, does it answer the question, is anything missing, is it in your language. It runs on every whole-repository answer and on any draft that is less than certain; a clean, confident draft whose citations all check out goes straight through.",
    Icon: ShieldCheckIcon,
  },
];

export default function AnswerPipeline() {
  const motionOK = useMotionOK();
  const [active, setActive] = useState(0);
  const items = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    for (const item of items.current) if (item) observer.observe(item);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
      {/* The diagram, beside the stages on a wide screen */}
      <div className="hidden lg:col-span-5 lg:block">
        <div className="sticky top-28">
          <ol className="relative space-y-2.5" aria-hidden="true">
            <span className="absolute bottom-6 left-[27px] top-6 w-px bg-hairline-strong" />
            <motion.span
              className="absolute left-[27px] top-6 w-px origin-top bg-ink"
              initial={false}
              animate={{ height: `${(active / STEPS.length) * 86}%` }}
              transition={{ duration: motionOK ? 0.6 : 0, ease: EASE }}
            />
            {STEPS.map((step, index) => {
              const state = index === active ? "on" : index < active ? "done" : "next";
              return (
                <li key={step.short} className="relative flex items-center gap-4">
                  <span
                    className={`relative z-10 flex h-14 w-14 flex-none items-center justify-center rounded-2xl border transition-[background-color,border-color,color,transform] duration-300 ease-out-expo ${
                      state === "on"
                        ? "scale-105 border-ink bg-ink text-canvas shadow-float"
                        : state === "done"
                          ? "border-hairline-strong bg-surface text-ink"
                          : "border-hairline bg-surface text-mute"
                    }`}
                  >
                    <step.Icon className="h-5 w-5" />
                  </span>
                  <span className={`text-[15px] transition-colors duration-300 ${state === "on" ? "font-medium text-ink" : "text-mute"}`}>
                    <span className="mr-2 font-mono text-[12px] tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    {step.short}
                    {index === 3 ? <span className="ml-1.5 font-normal text-mute">if not, search again</span> : null}
                  </span>
                  {index === 3 ? (
                    // From "Enough?" back to "Search": two rows of 56px nodes and 10px gaps up.
                    <svg className="absolute left-[-34px] top-[-112px] h-[148px] w-8 text-mute" viewBox="0 0 32 148" fill="none">
                      <path d="M30 140 C 4 140, 4 8, 30 8" stroke="currentColor" strokeWidth="1.25" strokeDasharray="3 4" />
                      <path d="M24 3 L31 8 L24 13" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </li>
              );
            })}
            <li className="relative flex items-center gap-4 pt-2">
              <span
                className={`relative z-10 flex h-14 w-14 flex-none items-center justify-center rounded-full border transition-colors duration-300 ${
                  active === STEPS.length - 1 ? "border-[rgb(234_179_8/0.7)] bg-[rgb(250_204_21/0.15)] text-ink" : "border-hairline bg-surface text-mute"
                }`}
              >
                <CheckCircleIcon className="h-5 w-5" />
              </span>
              <span className="text-[15px] text-body">An answer with a source on every claim</span>
            </li>
          </ol>
        </div>
      </div>

      {/* The stages */}
      <ol className="space-y-6 lg:col-span-7 lg:space-y-0">
        {STEPS.map((step, index) => (
          <li
            key={step.short}
            ref={(element) => {
              items.current[index] = element;
            }}
            data-step={index}
            className={`rounded-2xl border p-6 transition-[border-color,background-color,opacity] duration-500 sm:p-7 lg:my-[14vh] lg:first:mt-0 lg:last:mb-0 ${
              index === active ? "border-hairline-strong bg-surface shadow-raise" : "border-transparent lg:opacity-60"
            }`}
          >
            <div className="flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-surface text-ink">
                <step.Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="font-mono text-[12px] tabular-nums text-mute">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <h3 className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink lg:mt-0">{step.title}</h3>
            <p className="mt-3 text-[16px] leading-7 text-body">{step.body}</p>
            <UnderTheHood className="mt-4">{step.hood}</UnderTheHood>
          </li>
        ))}
      </ol>
    </div>
  );
}

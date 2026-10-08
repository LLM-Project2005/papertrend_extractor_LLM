"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { DEMO_PAPER_COUNT, DEMO_YEARS } from "@/components/marketing/demo-data";
import { EASE, useMotionOK, useSequence } from "@/components/marketing/kit/motion";
import ThinkingOrb from "@/components/ui/ThinkingOrb";
import { ChartIcon, ChatIcon, CheckCircleIcon, CircleIcon, GlobeIcon, SearchIcon } from "@/components/ui/Icons";

/*
 * The three ways to ask, as tabs: a quick answer (with the web when wanted),
 * deep research (a plan you approve, then a checked report), and Chart mode
 * (a chart computed from the analysed papers). Each panel says what it does
 * and shows it once, small. Facts: repository-chat-web.ts, deep-research/*,
 * chat-chart.ts.
 *
 * Tabs follow the WAI-ARIA pattern: arrow keys move between them, and each
 * panel is labelled by its tab.
 */

const MODES = [
  { key: "answer", label: "Quick answer", Icon: ChatIcon },
  { key: "research", label: "Deep research", Icon: SearchIcon },
  { key: "chart", label: "Chart", Icon: ChartIcon },
] as const;

type Mode = (typeof MODES)[number]["key"];

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-[15px] leading-7 text-body">
      <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 flex-none rounded-full bg-ink/40" />
      <span>{children}</span>
    </li>
  );
}

function AnswerVisual() {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5 text-[14px] leading-6">
      <p className="text-ink">
        Restored mangroves cut flood damage most where there was room to plant them
        <sup className="ml-0.5 font-mono text-[10px] text-accent-ink">1</sup>.
      </p>
      <div className="mt-4 border-t border-dashed border-hairline-strong pt-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <GlobeIcon className="h-4 w-4" /> Web context
          <span className="font-normal text-mute">· dated the day it was searched</span>
        </p>
        <p className="mt-2 text-body">
          A national programme reports 1,200 hectares replanted since 2021
          <span className="ml-1 rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-body">example.org</span>
        </p>
        <p className="mt-2 text-[12.5px] text-mute">Kept only because 1,200 appears on the page it links to.</p>
      </div>
    </div>
  );
}

const PLAN = [
  { q: "What do the papers measure as flood damage?", src: "Papers" },
  { q: "Where do mangroves and seawalls work best?", src: "Papers" },
  { q: "What has changed in national policy since 2023?", src: "Papers + web" },
];

function ResearchVisual({ play }: { play: boolean }) {
  const motionOK = useMotionOK();
  const [step] = useSequence([900, 800, 800, 800, 900, 99999], play && motionOK, false);
  const shown = motionOK ? step : 5;
  const done = Math.max(0, Math.min(PLAN.length, shown - 1));
  const report = shown >= 4;
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5">
      <AnimatePresence mode="wait" initial={false}>
        {!report ? (
          <motion.div key="plan" exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
            <p className="text-[12.5px] text-mute">The plan, before anything runs</p>
            <ol className="mt-3 space-y-2.5">
              {PLAN.map((item, index) => (
                <li key={item.q} className="flex items-start gap-3 text-[14px] leading-6">
                  {index < done ? (
                    <CheckCircleIcon className="mt-0.5 h-[18px] w-[18px] flex-none text-ink" />
                  ) : index === done && shown >= 1 ? (
                    <ThinkingOrb size={20} state="searching" className="mt-0.5" />
                  ) : (
                    <CircleIcon className="mt-0.5 h-[18px] w-[18px] flex-none text-hairline-strong" />
                  )}
                  <span className="flex-1 text-ink">{item.q}</span>
                  <span className="flex-none rounded-full bg-subtle px-2 py-0.5 text-[11px] text-body">{item.src}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex gap-2 text-[13px]">
              <span className="rounded-full border border-hairline px-3 py-1 text-body">Edit</span>
              <span className={`rounded-full px-3 py-1 ${shown >= 1 ? "bg-subtle text-mute" : "bg-ink text-canvas"}`}>
                {shown >= 1 ? "Running" : "Start"}
              </span>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="report"
            initial={motionOK ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <p className="text-[12.5px] text-mute">Deep research report · 22 sources</p>
            <div className="mt-3 space-y-3 text-[14px]">
              {["Direct answer", "Where each defence works", "What changed in policy", "What the papers searched don’t cover"].map((heading, index) => (
                <div key={heading}>
                  <p className="font-medium text-ink">{heading}</p>
                  <span className="mt-1.5 block h-1.5 rounded-full bg-ink/10 dark:bg-white/15" style={{ width: `${92 - index * 9}%` }} />
                </div>
              ))}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-body">
              <CheckCircleIcon className="h-3.5 w-3.5" /> Every sentence checked by Gemini 3.8 Flash
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChartVisual({ play }: { play: boolean }) {
  const motionOK = useMotionOK();
  const max = Math.max(...DEMO_YEARS.map((item) => item.papers));
  const drawn = play || !motionOK;
  return (
    <figure className="rounded-2xl border border-hairline bg-surface p-5">
      <p className="text-[14px] text-ink">How many papers were published each year?</p>
      <div className="mt-5 flex h-40 items-end gap-1.5" aria-hidden="true">
        {DEMO_YEARS.map((item, index) => (
          <div key={item.year} className="flex h-full flex-1 flex-col justify-end">
            <motion.span
              className={`block rounded-t-[4px] ${item.year === 2022 ? "bg-ink" : "bg-ink/25 dark:bg-white/30"}`}
              initial={false}
              animate={{ height: drawn ? `${(item.papers / max) * 100}%` : "0%" }}
              transition={{ duration: 0.7, delay: motionOK ? 0.15 + index * 0.04 : 0, ease: EASE }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-mute" aria-hidden="true">
        <span>{DEMO_YEARS[0].year}</span>
        <span>{DEMO_YEARS[DEMO_YEARS.length - 1].year}</span>
      </div>
      <figcaption className="mt-3 text-[12.5px] text-mute">
        Counted from {DEMO_PAPER_COUNT} analysed papers. 2022 has the most: 10. Click a bar to see its papers.
      </figcaption>
    </figure>
  );
}

export default function AskModes() {
  const id = useId();
  const [mode, setMode] = useState<Mode>("answer");
  const [seen, setSeen] = useState<Record<Mode, boolean>>({ answer: true, research: false, chart: false });
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setSeen((current) => (current[mode] ? current : { ...current, [mode]: true }));
  }, [mode]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.findIndex((item) => item.key === mode);
    const next =
      event.key === "ArrowRight" ? (index + 1) % MODES.length : event.key === "ArrowLeft" ? (index - 1 + MODES.length) % MODES.length : null;
    if (next === null) return;
    event.preventDefault();
    setMode(MODES[next].key);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Ways to ask" onKeyDown={onKey} className="inline-flex rounded-full border border-hairline bg-surface p-1">
        {MODES.map((item, index) => {
          const on = item.key === mode;
          return (
            <button
              key={item.key}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              role="tab"
              id={`${id}-tab-${item.key}`}
              aria-selected={on}
              aria-controls={`${id}-panel-${item.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setMode(item.key)}
              className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                on ? "bg-ink text-canvas" : "text-body hover:text-ink"
              }`}
            >
              <item.Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {MODES.map((item) => {
        const on = item.key === mode;
        return (
          <div
            key={item.key}
            role="tabpanel"
            id={`${id}-panel-${item.key}`}
            aria-labelledby={`${id}-tab-${item.key}`}
            hidden={!on}
            className="mt-10"
          >
            {/* Every panel's words are in the page; only the chosen one is shown. */}
            <div className="grid grid-cols-1 items-start gap-10 motion-safe:animate-rise-in lg:grid-cols-12 lg:gap-14">
                <div className="lg:col-span-5">
                  {item.key === "answer" ? (
                    <>
                      <h3 className="text-2xl font-semibold tracking-[-0.02em] text-ink">For the question in front of you.</h3>
                      <ul className="mt-5 space-y-2">
                        <Point>Ask the whole repository, or only the papers you attach, even one you upload mid-conversation.</Point>
                        <Point>Turn on web search to add what the papers can’t know. A web point is kept only if every number in it appears on the page it links to.</Point>
                        <Point>Follow-up suggestions come from what the answer did not cover.</Point>
                        <Point>Copy an answer, download it as Markdown with its sources, or export the whole conversation.</Point>
                      </ul>
                    </>
                  ) : item.key === "research" ? (
                    <>
                      <h3 className="text-2xl font-semibold tracking-[-0.02em] text-ink">For the question that needs a report.</h3>
                      <ul className="mt-5 space-y-2">
                        <Point>You see the plan first: two to five sub-questions and an outline. Start it, or edit your question and plan again.</Point>
                        <Point>It reads the full text of every paper in scope, leaving out reference lists, and goes to the web only where the papers cannot answer.</Point>
                        <Point>The report opens with a direct answer and ends with what the papers searched do not cover.</Point>
                        <Point>Gemini 3.8 Flash, a different model from the writer, checks every sentence; one that fails is revised once or removed.</Point>
                        <Point>About 40 seconds. Stop it at any time; resume it where it stopped.</Point>
                      </ul>
                    </>
                  ) : (
                    <>
                      <h3 className="text-2xl font-semibold tracking-[-0.02em] text-ink">For the question that is really a count.</h3>
                      <ul className="mt-5 space-y-2">
                        <Point>Ask in plain words: papers per year, methods by theme, how categories shifted from early to late.</Point>
                        <Point>A small model turns the request into a query over a fixed set of measures. Code runs it. The model never writes a number.</Point>
                        <Point>Every bar opens the papers behind it. A request the data cannot answer gets a reason, and a list of what it can chart.</Point>
                      </ul>
                    </>
                  )}
                </div>
                <div className="lg:col-span-7">
                  {item.key === "answer" ? (
                    <AnswerVisual />
                  ) : item.key === "research" ? (
                    <ResearchVisual play={seen.research && on} />
                  ) : (
                    <ChartVisual play={seen.chart} />
                  )}
                </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

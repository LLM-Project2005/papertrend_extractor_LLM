"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { EASE, useMotionOK } from "@/components/marketing/kit/motion";
import { RefreshIcon } from "@/components/ui/Icons";

/*
 * "Which year is this paper from?" on a thesis cover with three years on it.
 * The reader picks a line; each line answers with the rule the year resolver
 * applies to it (worker nodes/year_resolver.py): a year beside a cited author
 * or a data-collection date is passed over, and a Thai academic year on a
 * thesis cover is taken and converted from the Buddhist calendar (minus 543).
 *
 * The sample cover is invented. Every line is a button.
 */

type Line = {
  id: string;
  text: string;
  thai?: boolean;
  gloss?: string;
  right?: boolean;
  why: string;
  className?: string;
};

const LINES: Line[] = [
  {
    id: "title",
    text: "Peer Feedback in Thai EFL Writing Classrooms",
    why: "No year in the title. Keep looking.",
    className: "text-[17px] font-semibold leading-snug tracking-tight text-ink sm:text-[19px]",
  },
  {
    id: "cited",
    text: "Hyland and Hyland (2006) define feedback as information that helps a writer revise.",
    why: "2006 belongs to the work being cited, not to this thesis. A year beside an author’s name is passed over.",
  },
  {
    id: "collected",
    text: "Data were collected from 48 second-year students in the 2019 school year.",
    why: "That is when the data were collected. Years next to words like “collected”, “participants” or “school year” are never taken as the publication year.",
  },
  {
    id: "cover",
    text: "ปีการศึกษา 2563",
    thai: true,
    gloss: "Academic year 2563, on the thesis cover",
    right: true,
    why: "That’s the one. A thesis is dated by the academic year on its cover, and 2563 in the Thai calendar is 2020.",
  },
];

export default function YearPuzzle() {
  const motionOK = useMotionOK();
  const [picked, setPicked] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const choice = LINES.find((line) => line.id === picked) ?? null;
  const solved = Boolean(choice?.right);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-10">
      <div className="rounded-[20px] border border-hairline bg-surface p-3 shadow-float">
        <div className="rounded-[14px] border border-hairline px-5 py-7 text-center sm:px-10 sm:py-9">
          <p className="text-[11px] uppercase tracking-[0.16em] text-mute">A thesis submitted for the degree of Master of Arts</p>
          <ul className="mt-6 space-y-2">
            {LINES.map((line) => {
              const active = picked === line.id;
              return (
                <li key={line.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    disabled={solved}
                    onClick={() => {
                      setPicked(line.id);
                      setTries((count) => count + 1);
                    }}
                    lang={line.thai ? "th" : undefined}
                    className={`w-full rounded-xl px-3 py-2.5 text-[14px] leading-6 text-body transition-[background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active
                        ? line.right
                          ? "bg-[rgb(250_204_21/0.18)] ring-1 ring-[rgb(234_179_8/0.55)]"
                          : "bg-subtle ring-1 ring-hairline-strong"
                        : "hover:bg-subtle/70 disabled:hover:bg-transparent"
                    } ${line.className ?? ""} ${line.thai ? "text-[18px] font-medium text-ink" : ""}`}
                  >
                    {line.text}
                    {line.gloss ? <span className="mt-0.5 block text-[12px] font-normal text-mute" lang="en">{line.gloss}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-[11px] uppercase tracking-[0.16em] text-mute">Faculty of Arts · sample cover</p>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="min-h-[7.5rem]" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={choice?.id ?? "ask"}
              initial={motionOK ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              {choice ? (
                <>
                  <p className={`text-[17px] leading-7 ${solved ? "font-medium text-ink" : "text-body"}`}>{choice.why}</p>
                  {solved ? null : <p className="mt-2 text-[14px] text-mute">Try another line.</p>}
                </>
              ) : (
                <p className="text-[17px] leading-7 text-body">
                  Pick the line you would date this thesis by. There are three years on the page; only one of them dates it.
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* What Papertrend keeps, filled in once the year is found */}
        <dl className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-surface">
          <div className="border-b border-hairline bg-subtle/60 px-4 py-2.5 text-[12.5px] text-mute">What Papertrend records</div>
          {[
            ["Year", "2020"],
            ["Read from", "The thesis cover, converted from the Thai calendar"],
            ["Evidence", "“ปีการศึกษา 2563”"],
          ].map(([term, value], index) => (
            <div key={term} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
              <dt className="text-[12.5px] text-mute">{term}</dt>
              <dd className="min-h-[21px] text-[14px] font-medium text-ink">
                {solved ? (
                  <motion.span
                    className="evidence-mark"
                    data-on="true"
                    initial={motionOK ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4, delay: motionOK ? 0.2 + index * 0.15 : 0 }}
                  >
                    {value}
                  </motion.span>
                ) : (
                  <span className="text-mute">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">Not found yet</span>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex min-h-[28px] flex-wrap items-center gap-4 text-[13px] text-mute">
          {solved ? (
            <>
              <span>{tries === 1 ? "First try. Sharp eye." : `Found in ${tries} tries.`}</span>
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  setTries(0);
                }}
                className="inline-flex items-center gap-1.5 rounded-full px-1 py-1 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RefreshIcon className="h-3.5 w-3.5" /> Start over
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

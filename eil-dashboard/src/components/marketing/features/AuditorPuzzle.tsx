"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { EASE, useMotionOK } from "@/components/marketing/kit/motion";
import Mascot from "@/components/ui/Mascot";
import { CheckCircleIcon, RefreshIcon, WarningCircleIcon } from "@/components/ui/Icons";

/*
 * A small puzzle: the reader does the answer check by hand. Three sentences
 * from a draft answer, each beside the passage it cites; one claims more than
 * its passage says. Finding it shows what the real check does to such a
 * sentence before the answer is shown: it is rewritten to what the source
 * supports, or removed. (The check runs on whole-repository answers and on any
 * draft whose support is in doubt; repository-chat.ts.)
 *
 * Every choice is a button, so the puzzle works by keyboard and by touch, and
 * the outcome is announced in a live region.
 */

const DRAFT = [
  {
    id: "a",
    claim: "Households near restored mangroves reported about 38 percent less flood damage.",
    source:
      "Households living within 500 metres of restored mangrove cover reported 38 percent less flood damage than those behind the seawall.",
    paper: "Mangroves and seawalls: household choices in Semarang, 2022",
    verdict: "Supported. The figure and who it applies to both match the passage.",
  },
  {
    id: "b",
    claim: "Every study found that seawalls failed within fifteen years.",
    source:
      "Residents valued the seawall for the certainty it gave, but most expected it to need raising again within fifteen years.",
    paper: "Mangroves and seawalls: household choices in Semarang, 2022",
    verdict: "",
    fixed: "Most residents expected the seawall to need raising again within fifteen years.",
  },
  {
    id: "c",
    claim: "Land subsidence doubled the area flooded by ordinary spring tides between 2010 and 2020.",
    source:
      "Land subsidence, driven by groundwater extraction, doubled the area flooded by ordinary spring tides between 2010 and 2020.",
    paper: "Mangroves and seawalls: household choices in Semarang, 2022",
    verdict: "Supported, almost word for word.",
  },
] as const;

const WRONG = "b";

export default function AuditorPuzzle() {
  const motionOK = useMotionOK();
  const [picked, setPicked] = useState<string[]>([]);
  const solved = picked.includes(WRONG);
  const lastPick = picked[picked.length - 1] ?? null;

  const message = solved
    ? `Found it${picked.length === 1 ? " on the first try" : ""}. “Every study” and “failed” are not in the passage: one survey, and an expectation.`
    : lastPick
      ? DRAFT.find((item) => item.id === lastPick)?.verdict ?? ""
      : "";

  return (
    <div className="rounded-[26px] border border-hairline bg-surface p-5 shadow-raise sm:p-8">
      <div className="flex items-start gap-4">
        <Mascot size={40} state={solved ? "surprised" : lastPick ? "thinking" : "reading"} className="mt-0.5 text-ink" />
        <div>
          <p className="text-[17px] font-medium text-ink">Which sentence says more than its source?</p>
          <p className="mt-1 text-[14px] leading-6 text-body">
            A draft answer, each sentence beside the passage it cites. Choose the one that would not survive the check.
          </p>
        </div>
      </div>

      <ol className="mt-7 space-y-3">
        {DRAFT.map((item, index) => {
          const chosen = picked.includes(item.id);
          const isWrong = item.id === WRONG;
          const tone = chosen ? (isWrong ? "caught" : "fine") : "open";
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={solved || chosen}
                aria-pressed={chosen}
                onClick={() => setPicked((current) => [...current, item.id])}
                className={`group grid grid-cols-1 w-full gap-3 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-200 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-5 sm:p-5 ${
                  tone === "caught"
                    ? "border-[rgb(234_179_8/0.6)] bg-[rgb(250_204_21/0.08)]"
                    : tone === "fine"
                      ? "border-hairline bg-subtle/60"
                      : "border-hairline hover:border-hairline-strong hover:bg-subtle/50 active:scale-[0.995] disabled:hover:bg-transparent"
                }`}
              >
                <span className="flex gap-3">
                  <span className="mt-0.5 font-mono text-[12px] tabular-nums text-mute">{index + 1}</span>
                  <span className="text-[15px] leading-6 text-ink">
                    {isWrong && solved ? (
                      <>
                        <span className="text-mute line-through decoration-[rgb(234_179_8)] decoration-2">{item.claim}</span>
                        <motion.span
                          initial={motionOK ? { opacity: 0, y: 4 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, delay: 0.35, ease: EASE }}
                          className="mt-1.5 block font-medium"
                        >
                          {"fixed" in item ? item.fixed : ""}
                        </motion.span>
                      </>
                    ) : (
                      item.claim
                    )}
                  </span>
                </span>
                <span className="block border-l-2 border-hairline-strong pl-3 text-[13.5px] leading-6 text-body sm:border-l sm:pl-5">
                  <span className="italic">“{item.source}”</span>
                  <span className="mt-1 block text-[12px] not-italic text-mute">{item.paper}</span>
                </span>
                {chosen ? (
                  <span className="flex items-center gap-1.5 text-[13px] font-medium sm:col-span-2">
                    {isWrong ? (
                      <>
                        <WarningCircleIcon className="h-4 w-4 text-[rgb(202_138_4)]" /> Overreaches its source, rewritten
                      </>
                    ) : (
                      <>
                        <CheckCircleIcon className="h-4 w-4 text-body" /> Supported
                      </>
                    )}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 min-h-[3.5rem]" aria-live="polite">
        <AnimatePresence mode="wait">
          {message ? (
            <motion.p
              key={message}
              initial={motionOK ? { opacity: 0, y: 4 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="text-[14.5px] leading-6 text-body"
            >
              {message}
              {solved ? (
                <span className="mt-1 block text-ink">
                  Papertrend does this before an answer reaches you: a claim that says more than its source is rewritten or removed.
                </span>
              ) : lastPick ? (
                <span className="mt-1 block">Try another.</span>
              ) : null}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      {picked.length > 0 ? (
        <button
          type="button"
          onClick={() => setPicked([])}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-[13px] text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshIcon className="h-3.5 w-3.5" /> Start over
        </button>
      ) : null}
    </div>
  );
}

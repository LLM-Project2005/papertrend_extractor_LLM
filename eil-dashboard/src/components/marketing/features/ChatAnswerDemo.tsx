"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { DEMO_ANSWER, DEMO_CITATIONS, DEMO_PAPER_COUNT, DEMO_QUESTION, DEMO_REPOSITORY } from "@/components/marketing/demo-data";
import Hotspot from "@/components/marketing/kit/Hotspot";
import { EASE, useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";
import ThinkingOrb, { orbStateForStage } from "@/components/ui/ThinkingOrb";
import { CopyIcon, DownloadIcon, RefreshIcon } from "@/components/ui/Icons";

/*
 * One answer, written in front of the reader: the question, the stages the
 * real chat reports while it works (src/lib/chat-progress.ts), then the answer
 * a sentence at a time with its citations. Each citation opens the sentence in
 * the paper it rests on, and marks the claim it supports.
 *
 * It plays once when it comes into view and stops on the finished answer, with
 * a button to play it again. Under reduced motion it is the finished answer.
 */

const STAGES: Array<{ key: string; label: string; ms: number }> = [
  { key: "planning", label: "Understanding your question", ms: 1100 },
  { key: "retrieving", label: `Searching ${DEMO_PAPER_COUNT} papers`, ms: 1200 },
  { key: "reading_evidence", label: "Reading the relevant passages", ms: 1200 },
  { key: "synthesizing", label: "Writing the answer", ms: 900 },
  { key: "checking", label: "Checking it against the evidence", ms: 1100 },
];

// Steps: 0 empty, 1 question, 2..6 stages, 7..9 one sentence each, 10 done.
const DURATIONS = [500, 900, ...STAGES.map((stage) => stage.ms), 700, 700, 900, 99999];
const DONE = DURATIONS.length - 1;

export default function ChatAnswerDemo() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.4 });
  const [started, setStarted] = useState(false);
  const [step, setStep] = useSequence(DURATIONS, started && motionOK, false);
  const [marked, setMarked] = useState<number | null>(null);

  useEffect(() => {
    if (onScreen && motionOK) setStarted(true);
  }, [onScreen, motionOK]);

  const shown = motionOK ? step : DONE;
  const stage = shown >= 2 && shown < 2 + STAGES.length ? STAGES[shown - 2] : null;
  const sentences = Math.max(0, Math.min(DEMO_ANSWER.length, shown - (1 + STAGES.length)));
  const finished = shown >= DONE;

  const replay = useCallback(() => {
    setMarked(null);
    setStep(0);
  }, [setStep]);

  return (
    <div ref={ref} className="relative">
      <div className="overflow-hidden rounded-[22px] border border-hairline bg-surface shadow-float">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <p className="truncate text-[12.5px] text-mute">
            Searching {DEMO_PAPER_COUNT} analysed papers in {DEMO_REPOSITORY}
          </p>
          <span className="flex-none rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-body">Sample collection</span>
        </div>

        <div className="min-h-[380px] space-y-5 px-5 py-6 sm:min-h-[400px] sm:px-6">
          <AnimatePresence initial={false}>
            {shown >= 1 ? (
              <motion.p
                key="question"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE }}
                className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-subtle px-4 py-2.5 text-[14.5px] leading-6 text-ink"
              >
                {DEMO_QUESTION}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <div className="h-6" aria-live="polite">
            {stage ? (
              <p className="flex items-center gap-2.5 text-[13.5px] text-body">
                <ThinkingOrb size={20} state={orbStateForStage(stage.key)} />
                <span key={stage.key} className="status-swap">
                  {stage.label}…
                </span>
              </p>
            ) : null}
          </div>

          <div className="space-y-3 text-[15px] leading-7 text-ink">
            {DEMO_ANSWER.slice(0, sentences).map((sentence, index) => (
              <motion.p
                key={sentence.cite}
                initial={motionOK ? { opacity: 0, y: 6, filter: "blur(3px)" } : false}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.55, ease: EASE }}
                className={index === 0 ? "" : "text-body"}
              >
                <span className="evidence-mark" data-on={marked === sentence.cite}>
                  {sentence.text}
                </span>
                <Hotspot
                  variant="cite"
                  label={String(sentence.cite)}
                  title={`${DEMO_CITATIONS[sentence.cite - 1].title} (${DEMO_CITATIONS[sentence.cite - 1].year})`}
                  side="top"
                  align={index === 1 ? "center" : "end"}
                  onOpenChange={(open) => setMarked((current) => (open ? sentence.cite : current === sentence.cite ? null : current))}
                >
                  <span className="mt-1 block border-l-2 border-[rgb(234_179_8/0.7)] pl-3 italic text-ink/80">
                    “{DEMO_CITATIONS[sentence.cite - 1].quote}”
                  </span>
                  <span className="mt-2 block text-[12px] text-mute">Opens the paper at this passage.</span>
                </Hotspot>
              </motion.p>
            ))}
          </div>

          <AnimatePresence>
            {finished ? (
              <motion.div
                key="footer"
                initial={motionOK ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-4 text-[12.5px] text-mute"
              >
                <span>Covered all {DEMO_PAPER_COUNT} papers in {DEMO_REPOSITORY}</span>
                <span className="inline-flex items-center gap-1.5">
                  <CopyIcon className="h-3.5 w-3.5" /> Copy
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <DownloadIcon className="h-3.5 w-3.5" /> Download (.md)
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {finished && motionOK ? (
        <button
          type="button"
          onClick={replay}
          className="absolute -bottom-12 right-1 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          Play again
        </button>
      ) : null}
      <p className="sr-only">
        A sample answer from an invented collection of {DEMO_PAPER_COUNT} papers. Each sentence carries a numbered source; open a
        number to read the sentence in the paper it came from.
      </p>
    </div>
  );
}

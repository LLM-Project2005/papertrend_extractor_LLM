"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DEMO_PAPER } from "@/components/marketing/demo-data";
import { EASE, useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";
import { RefreshIcon } from "@/components/ui/Icons";

/*
 * A paper being read. On the left, the first page of the sample paper; a
 * reading line moves down it, and the words each finding was taken from are
 * marked as it passes. On the right, the record fills in, each value with the
 * place it came from. It is the analysis's promise in one picture: every value
 * has a source you can see.
 *
 * Plays once in view, ends on the full record, and can be played again.
 * Under reduced motion it is the full record with every passage marked.
 */

const FIELDS = [
  { key: "title", label: "Title", value: DEMO_PAPER.title, from: "The title block" },
  { key: "year", label: "Year", value: "2022", from: "The journal issue line" },
  { key: "keywords", label: "The paper’s own keywords", value: DEMO_PAPER.authorKeywords.join(" · "), from: "Its keyword list" },
  { key: "method", label: "Method", value: "Household survey (412 households) and interviews", from: "The methods section" },
  { key: "finding", label: "A key finding", value: "38% less flood damage near restored mangroves", from: "The results section" },
  { key: "category", label: "Research area", value: DEMO_PAPER.category, from: "With a written reason" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

// The reading line's position (percent of the page) when each field is found.
const AT: Record<FieldKey, number> = { title: 12, year: 22, keywords: 46, method: 64, finding: 82, category: 96 };
const DURATIONS = [600, 900, 900, 1000, 1000, 1000, 1100, 99999];
const DONE = DURATIONS.length - 1;

export default function PaperReadingDemo() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.35 });
  const [started, setStarted] = useState(false);
  const [step, setStep] = useSequence(DURATIONS, started && motionOK, false);

  useEffect(() => {
    if (onScreen && motionOK) setStarted(true);
  }, [onScreen, motionOK]);

  const shown = motionOK ? step : DONE;
  const found = Math.max(0, Math.min(FIELDS.length, shown - 1));
  const isFound = (key: FieldKey) => FIELDS.findIndex((field) => field.key === key) < found;
  const scan = found === 0 ? 4 : AT[FIELDS[found - 1].key];
  const reading = shown >= 1 && shown < DONE;

  return (
    <div ref={ref} className="relative grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-8">
      {/* The page */}
      <figure className="relative overflow-hidden rounded-[18px] border border-hairline bg-surface p-6 shadow-float sm:p-8" aria-label="The first page of a sample paper">
        <div className="space-y-4 text-[12.5px] leading-[1.7] text-body sm:text-[13px]">
          <p className="font-mono text-[11px] text-mute">
            <span className="evidence-mark" data-on={isFound("year")}>
              {DEMO_PAPER.journalLine}
            </span>
          </p>
          <p className="text-[19px] font-semibold leading-snug tracking-tight text-ink sm:text-[21px]">
            <span className="evidence-mark" data-on={isFound("title")}>
              {DEMO_PAPER.title}
            </span>
          </p>
          <p className="text-[11.5px] text-mute">{DEMO_PAPER.received}</p>
          <p>
            <span className="font-semibold text-ink">Abstract. </span>
            {DEMO_PAPER.abstract}
          </p>
          <p>
            <span className="font-semibold text-ink">Keywords: </span>
            <span className="evidence-mark" data-on={isFound("keywords")}>
              {DEMO_PAPER.authorKeywords.join("; ")}
            </span>
          </p>
          <p>
            <span className="font-semibold text-ink">2. Methods. </span>
            <span className="evidence-mark" data-on={isFound("method")}>
              {DEMO_PAPER.methods}
            </span>
          </p>
          <p>
            <span className="font-semibold text-ink">3. Results. </span>
            <span className="evidence-mark" data-on={isFound("finding")}>
              {DEMO_PAPER.result}
            </span>
          </p>
          <p className="text-mute">
            <span className="font-semibold text-body">5. Conclusion. </span>
            {DEMO_PAPER.conclusion}
          </p>
        </div>
        {/* The reading line */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 h-16 -translate-y-1/2"
          initial={false}
          animate={{ top: `${scan}%`, opacity: reading ? 1 : 0 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          <div className="h-full bg-gradient-to-b from-transparent via-accent/[0.07] to-transparent" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-accent/50" />
        </motion.div>
      </figure>

      {/* The record */}
      <div className="rounded-[18px] border border-hairline bg-canvas/60 p-2 dark:bg-surface/60">
        <dl className="divide-y divide-hairline rounded-[14px] border border-hairline bg-surface">
          {FIELDS.map((field, index) => {
            const on = index < found;
            return (
              <div key={field.key} className="grid grid-cols-1 min-h-[68px] gap-0.5 px-4 py-3 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4">
                <dt className="pt-0.5 text-[12.5px] text-mute">{field.label}</dt>
                <dd className="min-w-0">
                  <AnimatePresence mode="wait" initial={false}>
                    {on ? (
                      <motion.span
                        key="value"
                        initial={motionOK ? { opacity: 0, y: 6, filter: "blur(3px)" } : false}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="block"
                      >
                        <span className="block text-[14px] font-medium leading-6 text-ink">{field.value}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
                          <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-[rgb(250_204_21/0.75)]" />
                          {field.from}
                        </span>
                      </motion.span>
                    ) : (
                      <motion.span key="empty" exit={{ opacity: 0 }} className="mt-1.5 block space-y-2" aria-hidden="true">
                        <span className="block h-2.5 w-3/4 rounded-full bg-subtle" />
                        <span className="block h-2 w-1/3 rounded-full bg-subtle" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      {shown >= DONE && motionOK ? (
        <button
          type="button"
          onClick={() => setStep(0)}
          className="absolute -bottom-11 right-1 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          Read it again
        </button>
      ) : null}
    </div>
  );
}

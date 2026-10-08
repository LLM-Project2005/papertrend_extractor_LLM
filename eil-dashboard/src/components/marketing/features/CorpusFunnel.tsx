"use client";

import { motion } from "framer-motion";
import { DEMO_PAPER_COUNT } from "@/components/marketing/demo-data";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { CheckCircleIcon } from "@/components/ui/Icons";

/*
 * A question about every paper at once, as it is really answered
 * (repository-chat.ts, aggregate_corpus): the papers are read in groups of
 * ten, each group is summarised, the themes and methods are counted by code,
 * and one answer is written from the summaries and the counts, then checked.
 *
 * The four stages appear in turn when the figure comes into view; under
 * reduced motion they are simply all there.
 */

const GROUPS = Array.from({ length: Math.ceil(DEMO_PAPER_COUNT / 10) }, (_, index) =>
  Math.min(10, DEMO_PAPER_COUNT - index * 10)
);

const STAGES = [
  { title: `${DEMO_PAPER_COUNT} papers`, note: "Every analysed paper in the repository, nothing sampled." },
  { title: `${GROUPS.length} groups of up to ten`, note: "Each group is read and summarised on its own." },
  { title: "Counted, not guessed", note: "Themes and methods are tallied by code, the way the dashboard counts them." },
  { title: "One checked answer", note: "Written from the summaries and the counts, then audited. Always." },
];

function Arrow({ shown, delay }: { shown: boolean; delay: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 12" className="mx-auto h-3 w-10 rotate-90 text-hairline-strong lg:rotate-0" fill="none">
      <motion.path
        d="M1 6 H36 M31 1.5 L37 6 L31 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: shown ? 1 : 0 }}
        transition={{ duration: 0.5, delay, ease: EASE }}
      />
    </svg>
  );
}

export default function CorpusFunnel() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.3 });
  const shown = onScreen || !motionOK;
  const at = (stage: number) => (motionOK ? stage * 0.75 : 0);
  const appear = (stage: number) => ({
    initial: motionOK ? { opacity: 0, y: 10 } : false,
    animate: shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 },
    transition: { duration: 0.6, delay: at(stage), ease: EASE },
  });

  return (
    <div ref={ref} className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:gap-2">
      {/* 1. The papers */}
      <figure data-stage="0" className="rounded-2xl border border-hairline bg-surface p-5">
        <motion.div {...appear(0)} className="grid grid-cols-9 gap-1.5" aria-hidden="true">
          {Array.from({ length: DEMO_PAPER_COUNT }, (_, index) => (
            <motion.span
              key={index}
              className="aspect-[3/4] rounded-[3px] bg-ink/15 dark:bg-white/20"
              initial={motionOK ? { opacity: 0, scale: 0.6 } : false}
              animate={shown ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.3, delay: motionOK ? index * 0.012 : 0 }}
            />
          ))}
        </motion.div>
        <figcaption className="mt-5">
          <span className="block text-[15px] font-medium text-ink">{STAGES[0].title}</span>
          <span className="mt-1 block text-[13.5px] leading-6 text-body">{STAGES[0].note}</span>
        </figcaption>
      </figure>

      <div className="flex items-center justify-center py-1"><Arrow shown={shown} delay={at(1) - 0.3} /></div>

      {/* 2. The groups */}
      <figure data-stage="1" className="rounded-2xl border border-hairline bg-surface p-5">
        <motion.div {...appear(1)} className="space-y-2" aria-hidden="true">
          {GROUPS.map((size, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="flex h-6 flex-1 items-center gap-[3px] rounded-md bg-subtle px-1.5">
                {Array.from({ length: size }, (_, dot) => (
                  <span key={dot} className="h-3 w-[7px] rounded-[2px] bg-ink/25 dark:bg-white/25" />
                ))}
              </span>
              <motion.span
                className="h-1.5 rounded-full bg-ink/70"
                initial={false}
                animate={{ width: shown ? `${18 + size * 2.2}%` : "0%" }}
                transition={{ duration: 0.6, delay: at(1) + 0.3 + index * 0.12, ease: EASE }}
              />
            </div>
          ))}
        </motion.div>
        <figcaption className="mt-5">
          <span className="block text-[15px] font-medium text-ink">{STAGES[1].title}</span>
          <span className="mt-1 block text-[13.5px] leading-6 text-body">{STAGES[1].note}</span>
        </figcaption>
      </figure>

      <div className="flex items-center justify-center py-1"><Arrow shown={shown} delay={at(2) - 0.3} /></div>

      {/* 3. The counts */}
      <figure data-stage="2" className="rounded-2xl border border-dashed border-hairline-strong bg-canvas p-5 dark:bg-surface">
        <motion.dl {...appear(2)} className="space-y-2 font-mono text-[12.5px] tabular-nums" aria-hidden="true">
          {[
            ["Coastal flood risk mapping", 7],
            ["Mangrove restoration", 7],
            ["Managed retreat", 6],
            ["Household surveys (method)", 7],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-center justify-between gap-3 border-b border-hairline pb-2 last:border-b-0">
              <dt className="truncate text-body">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </motion.dl>
        <figcaption className="mt-5">
          <span className="block text-[15px] font-medium text-ink">{STAGES[2].title}</span>
          <span className="mt-1 block text-[13.5px] leading-6 text-body">{STAGES[2].note}</span>
        </figcaption>
      </figure>

      <div className="flex items-center justify-center py-1"><Arrow shown={shown} delay={at(3) - 0.3} /></div>

      {/* 4. The answer */}
      <figure data-stage="3" className="rounded-2xl border border-hairline-strong bg-surface p-5 shadow-float">
        <motion.div {...appear(3)} className="space-y-2" aria-hidden="true">
          <span className="block h-2.5 w-11/12 rounded-full bg-ink/70" />
          <span className="block h-2 w-full rounded-full bg-ink/15 dark:bg-white/15" />
          <span className="block h-2 w-10/12 rounded-full bg-ink/15 dark:bg-white/15" />
          <span className="block h-2 w-9/12 rounded-full bg-ink/15 dark:bg-white/15" />
          <span className="mt-3 flex items-center gap-1.5 text-[12px] text-body">
            <CheckCircleIcon className="h-3.5 w-3.5" /> Covered all {DEMO_PAPER_COUNT} papers
          </span>
        </motion.div>
        <figcaption className="mt-5">
          <span className="block text-[15px] font-medium text-ink">{STAGES[3].title}</span>
          <span className="mt-1 block text-[13.5px] leading-6 text-body">{STAGES[3].note}</span>
        </figcaption>
      </figure>
    </div>
  );
}

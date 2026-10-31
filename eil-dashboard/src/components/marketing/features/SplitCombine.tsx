"use client";

import { useEffect, useState } from "react";
import { DEMO_PAPER_COUNT } from "@/components/marketing/demo-data";
import { SPLIT_COMBINE } from "@/components/marketing/how-it-works-content";
import { useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";
import { CheckCircleIcon } from "@/components/ui/Icons";

/*
 * A question about the whole repository, split into groups of ten and combined
 * (docs/33, section 5), with the sample collection's numbers set in type
 * (2026-10-31, UI audit: no dot for each paper). The stages light in turn once
 * when seen; the summaries and the counts light together, because they are
 * made side by side. Then it rests, lit.
 */

const GROUP = 10;
const groups = Math.ceil(DEMO_PAPER_COUNT / GROUP);
// Step 0 waits; stages 1-6 (3 and 4 together); 7 is done.
const DURATIONS = [300, 900, 900, 1100, 900, 900, 99999];
const DONE = DURATIONS.length - 1;

function Figure({ value, unit, lit }: { value: number; unit: string; lit: boolean }) {
  return (
    <span className={`flex items-baseline gap-1.5 transition-colors duration-500 ${lit ? "text-ink" : "text-mute"}`}>
      <span className="text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</span>
      <span className="text-[13px] font-medium">{unit}</span>
    </span>
  );
}

export default function SplitCombine() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLOListElement>({ once: true, amount: 0.3 });
  const [started, setStarted] = useState(false);
  const [step] = useSequence(DURATIONS, started && motionOK, false);

  useEffect(() => {
    if (onScreen && motionOK) setStarted(true);
  }, [onScreen, motionOK]);

  const shown = motionOK ? step : DONE;
  // Stages light at steps 1, 2, 3 (summaries and counts together), 4 and 5.
  const litAt = [1, 2, 3, 3, 4, 5];
  const visuals = [
    <Figure key="all" value={DEMO_PAPER_COUNT} unit="papers" lit={shown >= litAt[0]} />,
    <Figure key="split" value={groups} unit="groups" lit={shown >= litAt[1]} />,
    <Figure key="summaries" value={groups} unit="summaries" lit={shown >= litAt[2]} />,
    <span key="counts" className="flex h-[26px] items-end gap-1">
      {[70, 100, 45, 80].map((height, index) => (
        // A small chart of counts, grown by transform alone (Hallmark 10a: never animate height).
        <span
          key={index}
          className={`w-2 origin-bottom rounded-t-sm transition-[transform,background-color] duration-500 ease-out-expo ${shown >= litAt[3] ? "bg-accent" : "bg-hairline-strong"}`}
          style={{ height: `${height}%`, transform: shown >= litAt[3] ? "scaleY(1)" : `scaleY(${20 / height})` }}
        />
      ))}
    </span>,
    <Figure key="one" value={1} unit="answer" lit={shown >= litAt[4]} />,
    <CheckCircleIcon
      key="checked"
      className={`h-[26px] w-[26px] transition-colors duration-500 ${shown >= litAt[5] ? "text-ink" : "text-mute"}`}
    />,
  ];

  return (
    <div>
      <ol ref={ref} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
        {SPLIT_COMBINE.map((stage, index) => {
          const on = shown === litAt[index];
          return (
            <li
              key={stage.title}
              className={`flex min-w-0 flex-col gap-2.5 rounded-xl border bg-surface p-4 transition-[border-color,box-shadow] duration-400 ${
                on ? "border-accent shadow-[0_0_0_4px_rgb(var(--accent-soft))]" : shown > litAt[index] ? "border-hairline-strong" : "border-hairline"
              }`}
            >
              <span className="flex min-h-[26px] items-end">{visuals[index]}</span>
              <span className="text-[14px] font-medium leading-5 text-ink">{stage.title}</span>
              <span className="text-[12.5px] leading-[18px] text-body">{stage.detail}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[13px] leading-5 text-mute">Numbers from the sample collection of {DEMO_PAPER_COUNT} papers.</p>
    </div>
  );
}

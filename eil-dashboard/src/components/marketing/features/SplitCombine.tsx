"use client";

import { useEffect, useState } from "react";
import { DEMO_PAPER_COUNT } from "@/components/marketing/demo-data";
import { SPLIT_COMBINE } from "@/components/marketing/how-it-works-content";
import { useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";

/*
 * A question about the whole repository, split into groups of ten and combined
 * (docs/33, section 5), drawn with the sample collection's papers as dots. The
 * stages light in turn once when seen; the summaries and the counts light
 * together, because they are made side by side. Then it rests, lit.
 */

const GROUP = 10;
const groups = Math.ceil(DEMO_PAPER_COUNT / GROUP);
// Step 0 waits; stages 1-6 (3 and 4 together); 7 is done.
const DURATIONS = [300, 900, 900, 1100, 900, 900, 99999];
const DONE = DURATIONS.length - 1;

function Dots({ count, lit, split = false }: { count: number; lit: boolean; split?: boolean }) {
  const dot = (key: number) => (
    <span key={key} className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${lit ? "bg-accent" : "bg-hairline-strong"}`} />
  );
  if (!split) return <span className="flex flex-wrap content-start gap-[3px]">{Array.from({ length: count }, (_, index) => dot(index))}</span>;
  return (
    <span className="flex flex-wrap content-start gap-x-2 gap-y-[3px]">
      {Array.from({ length: groups }, (_, group) => (
        <span key={group} className="flex flex-wrap gap-[3px]">
          {Array.from({ length: Math.min(GROUP, count - group * GROUP) }, (_, index) => dot(group * GROUP + index))}
        </span>
      ))}
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
    <Dots key="all" count={DEMO_PAPER_COUNT} lit={shown >= litAt[0]} />,
    <Dots key="split" count={DEMO_PAPER_COUNT} lit={shown >= litAt[1]} split />,
    <Dots key="summaries" count={groups} lit={shown >= litAt[2]} />,
    <span key="counts" className="flex h-6 items-end gap-1">
      {[70, 100, 45, 80].map((height, index) => (
        <span
          key={index}
          className={`w-2 rounded-t-sm transition-[height,background-color] duration-500 ease-out-expo ${shown >= litAt[3] ? "bg-accent" : "bg-hairline-strong"}`}
          style={{ height: shown >= litAt[3] ? `${height}%` : "20%" }}
        />
      ))}
    </span>,
    <Dots key="one" count={1} lit={shown >= litAt[4]} />,
    <Dots key="checked" count={1} lit={shown >= litAt[5]} />,
  ];

  return (
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
            <span className="font-mono text-[11px] text-mute">{String(index + 1).padStart(2, "0")}</span>
            <span aria-hidden="true" className="min-h-6">
              {visuals[index]}
            </span>
            <span className="text-[14px] font-medium leading-5 text-ink">{stage.title}</span>
            <span className="text-[12.5px] leading-[18px] text-body">{stage.detail}</span>
          </li>
        );
      })}
    </ol>
  );
}

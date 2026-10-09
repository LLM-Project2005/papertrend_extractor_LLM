"use client";

import { useEffect, useState } from "react";
import { PLANNER_OPERATIONS } from "@/components/marketing/how-it-works-content";
import { useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";

/*
 * The operations a plan can choose from, lit one after another once when the
 * grid is seen, then left at rest. Those answered by code alone say so.
 */

const DURATIONS = [300, ...PLANNER_OPERATIONS.map(() => 750), 99999];

export default function PlannerOps() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLUListElement>({ once: true, amount: 0.3 });
  const [started, setStarted] = useState(false);
  const [step] = useSequence(DURATIONS, started && motionOK, false);

  useEffect(() => {
    if (onScreen && motionOK) setStarted(true);
  }, [onScreen, motionOK]);

  const lit = motionOK && step >= 1 && step <= PLANNER_OPERATIONS.length ? step - 1 : -1;

  return (
    <ul ref={ref} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {PLANNER_OPERATIONS.map((operation, index) => (
        <li
          key={operation.key}
          className={`flex flex-col gap-2 rounded-xl border bg-surface p-4 transition-[border-color,box-shadow,transform] duration-400 ease-out-expo ${
            index === lit ? "-translate-y-0.5 border-accent shadow-[0_0_0_4px_rgb(var(--accent-soft))]" : "border-hairline"
          }`}
        >
          <p className="flex items-center justify-between gap-2">
            <code className="font-mono text-[12.5px] font-medium text-ink">{operation.key}</code>
            <span
              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${
                operation.model === "no model" ? "bg-ink text-canvas" : "border border-hairline text-body"
              }`}
            >
              {operation.model}
            </span>
          </p>
          <p className="text-[13.5px] text-ink">{operation.when}</p>
          <p className="text-[12.5px] leading-[18px] text-body">{operation.how}</p>
        </li>
      ))}
      <li className="flex flex-col justify-center gap-2 rounded-xl border border-dashed border-hairline-strong p-4">
        <p className="text-[13.5px] font-medium text-ink">Questions the papers can’t answer</p>
        <p className="text-[12.5px] leading-[18px] text-body">
          Citation counts, h-index or impact factor are not in your PDFs, so they are pointed to Scopus, Web of Science or Google
          Scholar.
        </p>
      </li>
    </ul>
  );
}

"use client";

import { motion } from "framer-motion";
import { useEffect, useState, type ComponentType } from "react";
import Hotspot from "@/components/marketing/kit/Hotspot";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { CloudIcon, DatabaseIcon, FilePdfIcon, LightningIcon, MonitorIcon, SearchIcon, StackIcon } from "@/components/ui/Icons";

/*
 * The route one PDF takes (AnalyzeFlowModal, gcs-signed-urls.ts, the ingestion
 * queue and worker, search_index.py). A paper travels the route once when it is
 * seen, then waits at the end; every stop opens a note on what happens there.
 * On a narrow screen the stops are a list.
 */

type Stop = { key: string; label: string; Icon: ComponentType<{ className?: string }>; note: string };

const STOPS: Stop[] = [
  {
    key: "browser",
    label: "Your browser",
    Icon: MonitorIcon,
    note: "Checks each file before anything is sent: a PDF, no larger than 10 MB, and not already in your library (its fingerprint is compared with every paper you have).",
  },
  {
    key: "storage",
    label: "Private storage",
    Icon: CloudIcon,
    note: "A signed link lets your browser put the file straight into a private bucket on Google Cloud. Each link works for 30 minutes and for that one file.",
  },
  {
    key: "queue",
    label: "The queue",
    Icon: StackIcon,
    note: "Cloud Tasks hands the papers to the worker one at a time. Once every file is up, you can close the page.",
  },
  {
    key: "worker",
    label: "Analysis",
    Icon: LightningIcon,
    note: "The 13 steps run on Cloud Run. The worker sends a heartbeat every minute; a paper that stops answering is picked up again, at most twice.",
  },
  {
    key: "database",
    label: "Your repository",
    Icon: DatabaseIcon,
    note: "Saved in one transaction to Postgres in Singapore, readable only by your account; the database itself enforces that.",
  },
  {
    key: "index",
    label: "Search index",
    Icon: SearchIcon,
    note: "The paper’s passages are embedded for meaning search, so chat can find it by what it says, not only by its words.",
  },
];

export default function CloudRoute() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.5 });
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (!motionOK) {
      setAt(STOPS.length - 1);
      return;
    }
    if (!onScreen) return;
    const timers = STOPS.slice(1).map((_, index) => window.setTimeout(() => setAt(index + 1), 700 + index * 750));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onScreen, motionOK]);

  const position = (index: number) => `${(index / (STOPS.length - 1)) * 100}%`;

  return (
    <div ref={ref}>
      {/* Wide */}
      <div className="relative hidden px-10 pb-4 pt-16 lg:block">
        <div className="relative h-14">
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline-strong" />
          <motion.span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-ink"
            initial={false}
            animate={{ width: position(at) }}
            transition={{ duration: motionOK ? 0.7 : 0, ease: EASE }}
          />
          {/* the paper */}
          <motion.span
            aria-hidden="true"
            className="absolute -top-12 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-lg border border-hairline-strong bg-surface text-ink shadow-float"
            initial={false}
            animate={{ left: position(at) }}
            transition={{ duration: motionOK ? 0.7 : 0, ease: EASE }}
          >
            <FilePdfIcon className="h-4 w-4" />
          </motion.span>
          {STOPS.map((stop, index) => (
            <div key={stop.key} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: position(index) }}>
              <Hotspot
                label={stop.label}
                title={stop.label}
                side="bottom"
                align={index === 0 ? "start" : index === STOPS.length - 1 ? "end" : "center"}
                buttonClassName={(open) =>
                  `flex h-14 w-14 items-center justify-center rounded-2xl border transition-[background-color,border-color,color] duration-300 ${
                    open ? "border-ink bg-ink text-canvas" : index <= at ? "border-ink/60 bg-surface text-ink" : "border-hairline bg-surface text-mute"
                  }`
                }
                trigger={
                  <>
                    <stop.Icon className="h-5 w-5" />
                    <span className="sr-only">{stop.label}</span>
                  </>
                }
              >
                {stop.note}
              </Hotspot>
            </div>
          ))}
        </div>
        <div className="relative mt-5 h-6">
          {STOPS.map((stop, index) => (
            <span
              key={stop.key}
              aria-hidden="true"
              className={`absolute -translate-x-1/2 whitespace-nowrap text-[13px] transition-colors duration-300 ${index <= at ? "text-ink" : "text-mute"}`}
              style={{ left: position(index) }}
            >
              {stop.label}
            </span>
          ))}
        </div>
        <p className="mt-8 text-center text-[13px] text-mute">Open any stop for what happens there.</p>
      </div>

      {/* Narrow */}
      <ol className="relative space-y-5 border-l border-hairline-strong pl-6 lg:hidden">
        {STOPS.map((stop) => (
          <li key={stop.key} className="relative">
            <span className="absolute -left-[37px] flex h-6 w-6 items-center justify-center rounded-full border border-hairline-strong bg-surface text-ink">
              <stop.Icon className="h-3.5 w-3.5" />
            </span>
            <p className="text-[15px] font-medium text-ink">{stop.label}</p>
            <p className="mt-1 text-[14px] leading-6 text-body">{stop.note}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

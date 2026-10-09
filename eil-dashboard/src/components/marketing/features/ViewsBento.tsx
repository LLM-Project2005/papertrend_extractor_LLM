"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { DEMO_CATEGORIES, DEMO_YEARS } from "@/components/marketing/demo-data";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { categoricalColor } from "@/lib/chart-palette";
import { CheckIcon } from "@/components/ui/Icons";

/*
 * The dashboard's four views (DashboardClient TAB_DEFINITIONS), in the order
 * the dashboard shows them, each named by the question it answers, with a small
 * drawing of its kind of chart in the dashboard's own colours that draws itself
 * once when the grid is seen. Figures come from the sample collection the
 * product clips use (41 papers).
 */

function Tile({ className = "", view, question, body, children }: { className?: string; view: string; question: string; body: string; children: ReactNode }) {
  return (
    <article className={`group flex flex-col rounded-[22px] border border-hairline bg-surface p-6 transition-[border-color,box-shadow,transform] duration-300 ease-out-expo hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-float ${className}`}>
      <p className="text-[12.5px] text-mute">{view}</p>
      <h3 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ink">{question}</h3>
      <div className="my-6 flex-1" aria-hidden="true">
        {children}
      </div>
      <p className="text-[14.5px] leading-6 text-body">{body}</p>
    </article>
  );
}

const MAP_POINTS: Array<[number, number, number]> = [
  [22, 30, 0], [30, 22, 0], [34, 36, 0], [18, 42, 0], [27, 48, 0],
  [62, 20, 1], [70, 28, 1], [58, 32, 1], [74, 16, 1],
  [52, 68, 2], [60, 76, 2], [46, 78, 2], [66, 64, 2], [40, 66, 2],
];
const MAP_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [0, 3], [3, 4], [2, 4], [5, 6], [6, 7], [5, 8], [9, 10], [10, 11], [9, 12], [11, 13], [2, 7], [4, 13],
];

/** The sample collection's research areas, by their share of its 41 papers. */
const AREA_SHARES = [57, 22, 22];

export default function ViewsBento() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.2 });
  const on = onScreen || !motionOK;
  const max = Math.max(...DEMO_YEARS.map((item) => item.papers));

  return (
    <div ref={ref} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Tile
        view="Semantic Map"
        question="Which papers are neighbours?"
        body="The view the dashboard opens on. Each paper placed by the meaning of its text, gathered into neighbourhoods and joined to its nearest neighbours; drag them around, or switch to a fixed layout where distance shows similarity."
      >
        <svg viewBox="8 8 74 78" className="mx-auto h-44 w-full max-w-[260px]">
          {MAP_LINKS.map(([from, to], index) => (
            <motion.line
              key={index}
              x1={MAP_POINTS[from][0]}
              y1={MAP_POINTS[from][1]}
              x2={MAP_POINTS[to][0]}
              y2={MAP_POINTS[to][1]}
              stroke="currentColor"
              className="text-ink"
              strokeOpacity={0.25}
              strokeWidth={0.6}
              initial={false}
              animate={{ pathLength: on ? 1 : 0 }}
              transition={{ duration: 0.6, delay: motionOK ? 0.5 + index * 0.05 : 0, ease: EASE }}
            />
          ))}
          {MAP_POINTS.map(([x, y, group], index) => (
            <motion.circle
              key={index}
              cx={x}
              cy={y}
              r={2.6}
              fill={categoricalColor(group)}
              initial={false}
              animate={{ scale: on ? 1 : 0 }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              transition={{ duration: 0.4, delay: motionOK ? index * 0.03 : 0, ease: EASE }}
            />
          ))}
        </svg>
      </Tile>

      <Tile
        view="Area Analysis"
        question="What’s gaining ground, and where is the weight?"
        body="Themes by year, with a theme said to gain ground only when at least three papers show it and the pattern survives taking away any one of them. Then papers per research area, which areas a paper shares, and the leading topics in each."
      >
        <div className="flex h-20 items-end gap-1">
          {DEMO_YEARS.map((item, index) => (
            <div key={item.year} className="flex h-full flex-1 flex-col justify-end gap-px">
              {[0.5, 0.3, 0.2].map((share, layer) => (
                <motion.span
                  key={layer}
                  className="block w-full first:rounded-t-[3px]"
                  style={{ backgroundColor: categoricalColor(layer) }}
                  initial={false}
                  animate={{ height: on ? `${(item.papers / max) * share * 100}%` : "0%" }}
                  transition={{ duration: 0.7, delay: motionOK ? 0.1 + index * 0.035 + layer * 0.05 : 0, ease: EASE }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-2.5">
          {DEMO_CATEGORIES.map((area, index) => (
            <div key={area.key}>
              <p className="flex justify-between text-[12.5px] text-body">
                <span>{area.label}</span>
                <span className="tabular-nums text-mute">{AREA_SHARES[index]}%</span>
              </p>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-subtle">
                <motion.span
                  className="block h-full rounded-full"
                  style={{ backgroundColor: categoricalColor(index + 3) }}
                  initial={false}
                  animate={{ width: on ? `${AREA_SHARES[index]}%` : "0%" }}
                  transition={{ duration: 0.8, delay: motionOK ? 0.4 + index * 0.12 : 0, ease: EASE }}
                />
              </span>
            </div>
          ))}
        </div>
      </Tile>

      <Tile
        view="Keyword Explorer"
        question="Which words define it?"
        body="Look up a concept in English or Thai: when it appeared, which themes use it, and the sentences it appears in. Then the keywords the most papers share, and the themes across the years."
      >
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 50 }, (_, index) => {
            const strength = ((index * 37) % 11) / 10;
            return (
              <motion.span
                key={index}
                className="aspect-square rounded-[3px]"
                style={{ backgroundColor: categoricalColor(0) }}
                initial={false}
                animate={{ opacity: on ? 0.1 + strength * 0.8 : 0.05 }}
                transition={{ duration: 0.5, delay: motionOK ? 0.15 + (index % 10) * 0.04 + Math.floor(index / 10) * 0.04 : 0 }}
              />
            );
          })}
        </div>
      </Tile>

      <Tile
        view="Adaptive"
        question="What’s unusual here?"
        body="About a dozen kinds of computed pattern, from themes studied together to themes rising and fading, and example questions these papers can answer. An AI write-up can put them in words, but every number must equal a computed one."
      >
        <motion.div
          initial={motionOK ? { opacity: 0, y: 8 } : false}
          animate={on ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: motionOK ? 0.3 : 0, ease: EASE }}
          className="rounded-2xl border border-hairline bg-canvas/70 p-4 dark:bg-black/30"
        >
          <p className="text-[12px] text-mute">Studied together</p>
          <p className="mt-1.5 text-[15px] leading-6 text-ink">
            Mangrove restoration and community participation appear in the same 5 papers, more often than their sizes alone
            would predict.
          </p>
        </motion.div>
        <ul className="mt-4 space-y-2">
          {["Behind it: at least 3 papers", "Still true without any one of them", "Numbers computed, not written by a model"].map((check, index) => (
            <motion.li
              key={check}
              initial={motionOK ? { opacity: 0, x: -6 } : false}
              animate={on ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.45, delay: motionOK ? 0.6 + index * 0.15 : 0, ease: EASE }}
              className="flex items-center gap-2.5 text-[14px] text-body"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-canvas">
                <CheckIcon weight="bold" className="h-3 w-3" />
              </span>
              {check}
            </motion.li>
          ))}
        </ul>
      </Tile>
    </div>
  );
}

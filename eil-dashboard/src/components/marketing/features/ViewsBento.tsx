"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { DEMO_YEARS } from "@/components/marketing/demo-data";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { CheckIcon } from "@/components/ui/Icons";

/*
 * The dashboard's six views (DashboardClient TAB_DEFINITIONS), each named by
 * the question it answers, with a small drawing of its kind of chart that
 * draws itself once when the grid is seen. Figures come from the sample
 * collection the product clips use (41 papers, 83 topics, 408 keywords).
 */

function Count({ to, on, delay = 0 }: { to: number; on: boolean; delay?: number }) {
  const motionOK = useMotionOK();
  const value = useMotionValue(motionOK ? 0 : to);
  const shown = useTransform(value, (latest) => Math.round(latest).toLocaleString("en-US"));
  useEffect(() => {
    if (!on || !motionOK) {
      value.set(to);
      return;
    }
    const controls = animate(value, to, { duration: 1.2, delay, ease: EASE });
    return () => controls.stop();
  }, [on, motionOK, to, delay, value]);
  return <motion.span className="tabular-nums">{shown}</motion.span>;
}

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

export default function ViewsBento() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.2 });
  const on = onScreen || !motionOK;
  const max = Math.max(...DEMO_YEARS.map((item) => item.papers));

  return (
    <div ref={ref} className="grid grid-cols-1 gap-4 lg:grid-cols-6">
      <Tile
        className="lg:col-span-3"
        view="Overview"
        question="What’s in here?"
        body="The papers, the themes they share, their keywords and years, and how the studies were done, under one sentence that sums it up."
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["papers", 41],
            ["topics", 83],
            ["keywords", 408],
          ].map(([label, value], index) => (
            <div key={String(label)} className="flex flex-col-reverse">
              <dt className="text-[12.5px] text-mute">{label}</dt>
              <dd className="text-[28px] font-semibold tracking-tight text-ink">
                <Count to={Number(value)} on={on} delay={index * 0.15} />
              </dd>
            </div>
          ))}
          <div className="flex flex-col-reverse">
            <dt className="text-[12.5px] text-mute">years</dt>
            <dd className="text-[28px] font-semibold tracking-tight text-ink tabular-nums">’11–’25</dd>
          </div>
        </dl>
      </Tile>

      <Tile
        className="lg:col-span-3"
        view="Trend Analysis"
        question="What’s gaining ground?"
        body="Themes by year. A theme is said to gain ground only when at least three papers show it, and the pattern survives taking away any one of them."
      >
        <div className="flex h-24 items-end gap-1">
          {DEMO_YEARS.map((item, index) => (
            <div key={item.year} className="flex h-full flex-1 flex-col justify-end gap-px">
              {[0.5, 0.3, 0.2].map((share, layer) => (
                <motion.span
                  key={layer}
                  className={`block w-full first:rounded-t-[3px] ${["bg-ink/80", "bg-ink/40", "bg-ink/20"][layer]}`}
                  initial={false}
                  animate={{ height: on ? `${(item.papers / max) * share * 100}%` : "0%" }}
                  transition={{ duration: 0.7, delay: motionOK ? 0.1 + index * 0.035 + layer * 0.05 : 0, ease: EASE }}
                />
              ))}
            </div>
          ))}
        </div>
      </Tile>

      <Tile
        className="lg:col-span-2"
        view="Category Analysis"
        question="Where is the weight?"
        body="Papers per category per year, which categories a paper shares, and the leading topics in each."
      >
        <div className="space-y-3">
          {[
            ["Adaptation strategies", 57],
            ["Governance and finance", 22],
            ["Hazards and risk", 22],
          ].map(([label, share], index) => (
            <div key={String(label)}>
              <p className="flex justify-between text-[12.5px] text-body">
                <span>{label}</span>
                <span className="tabular-nums text-mute">{share}%</span>
              </p>
              <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-subtle">
                <motion.span
                  className="block h-full rounded-full bg-ink/70"
                  initial={false}
                  animate={{ width: on ? `${share}%` : "0%" }}
                  transition={{ duration: 0.8, delay: motionOK ? 0.2 + index * 0.12 : 0, ease: EASE }}
                />
              </span>
            </div>
          ))}
        </div>
      </Tile>

      <Tile
        className="lg:col-span-2"
        view="Keyword Explorer"
        question="Which words define it?"
        body="Look up a concept in English or Thai: when it appeared, which themes use it, and the sentences it appears in."
      >
        <div className="grid grid-cols-8 gap-1">
          {Array.from({ length: 40 }, (_, index) => {
            const strength = ((index * 37) % 11) / 10;
            return (
              <motion.span
                key={index}
                className="aspect-square rounded-[3px] bg-ink"
                initial={false}
                animate={{ opacity: on ? 0.06 + strength * 0.5 : 0.04 }}
                transition={{ duration: 0.5, delay: motionOK ? 0.15 + (index % 8) * 0.05 + Math.floor(index / 8) * 0.04 : 0 }}
              />
            );
          })}
        </div>
      </Tile>

      <Tile
        className="lg:col-span-2"
        view="Semantic Map"
        question="Which papers are neighbours?"
        body="Each paper placed by the meaning of its text, gathered into neighbourhoods, and joined to its three nearest neighbours."
      >
        <svg viewBox="8 8 74 78" className="mx-auto h-40 w-full max-w-[240px] text-ink">
          {MAP_LINKS.map(([from, to], index) => (
            <motion.line
              key={index}
              x1={MAP_POINTS[from][0]}
              y1={MAP_POINTS[from][1]}
              x2={MAP_POINTS[to][0]}
              y2={MAP_POINTS[to][1]}
              stroke="currentColor"
              strokeOpacity={0.3}
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
              r={2.4}
              className={["fill-current", "fill-current opacity-60", "fill-current opacity-35"][group]}
              initial={false}
              animate={{ scale: on ? 1 : 0 }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              transition={{ duration: 0.4, delay: motionOK ? index * 0.03 : 0, ease: EASE }}
            />
          ))}
        </svg>
      </Tile>

      <Tile
        className="lg:col-span-6"
        view="Adaptive"
        question="What’s unusual here?"
        body="About a dozen kinds of computed pattern: themes studied together, methods by theme, papers that bridge two fields, themes rising and fading. An AI write-up can put them in words, but code checks it: every number must equal a computed one, and a claim of cause is struck out."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center">
          <motion.div
            initial={motionOK ? { opacity: 0, y: 8 } : false}
            animate={on ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: motionOK ? 0.3 : 0, ease: EASE }}
            className="rounded-2xl border border-hairline bg-canvas/70 p-5 dark:bg-black/30"
          >
            <p className="text-[12px] text-mute">Studied together</p>
            <p className="mt-1.5 text-[16px] leading-7 text-ink">
              Mangrove restoration and community participation appear in the same 5 papers, more often than their sizes alone
              would predict.
            </p>
          </motion.div>
          <ul className="space-y-2.5">
            {["Behind it: at least 3 papers", "Still true without any one of them", "A duplicate counted once", "Numbers computed, not written by a model"].map((check, index) => (
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
        </div>
      </Tile>
    </div>
  );
}

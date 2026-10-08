"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import Hotspot from "@/components/marketing/kit/Hotspot";
import { EASE, useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";
import { PlayIcon } from "@/components/ui/Icons";

/*
 * The thirteen steps of the analysis (graphs.py, build_ingestion_graph) laid
 * out in time: left to right is the order they run in, and steps in the same
 * column run at the same time. A cursor sweeps across once when the figure is
 * seen; every step opens a note on what it reads, what it keeps, and which
 * model does it.
 *
 * On a narrow screen the same steps are an ordered list, the parallel ones
 * gathered under "At the same time".
 */

type Step = { id: string; label: string; col: number; row: number; note: string; optional?: boolean };

const STEPS: Step[] = [
  {
    id: "extract",
    label: "Read the PDF",
    col: 1,
    row: 2,
    note: "Takes the PDF’s own text layer. Pages without one, a scanned cover or a whole scanned thesis, are read by a vision model (Gemini 3.1 Flash-Lite), up to 24 pages.",
  },
  {
    id: "clean",
    label: "Clean",
    col: 2,
    row: 2,
    note: "Rejoins words broken across lines and drops page numbers and tables, but keeps a year that sits alone on a line. Decides whether the paper needs translating.",
  },
  {
    id: "translate",
    label: "Translate",
    col: 3,
    row: 2,
    optional: true,
    note: "Only when most of the letters are not Latin script, as in a Thai paper. Translated in parts for the analysis; your PDF is untouched. A part that fails stays in its language, with a note.",
  },
  {
    id: "segment",
    label: "Find the sections",
    col: 4,
    row: 2,
    note: "A model reads the outline of headings, in English or Thai, and marks the introduction, literature review, methods, results and conclusion. Heading rules take over if it cannot.",
  },
  {
    id: "metadata",
    label: "Title and year",
    col: 5,
    row: 1,
    note: "The title from the page layout, confirmed by a model. The year from the issue line, a “Published” line, a thesis cover or the front matter. A model may confirm a printed year but never supply one; doubtful years are checked with Crossref and OpenAlex.",
  },
  {
    id: "mine",
    label: "Grounded keywords",
    col: 5,
    row: 2,
    note: "A model proposes 12 to 20 subject and method terms. Each is kept only if it is in the paper; how often it appears is counted, and the sentence it appears in is copied, never paraphrased.",
  },
  {
    id: "author",
    label: "The paper’s own keywords",
    col: 5,
    row: 3,
    note: "The authors’ own list, found under “Keywords”, “Index terms” or “คำสำคัญ”.",
  },
  {
    id: "facets",
    label: "Aims and contributions",
    col: 5,
    row: 4,
    note: "What the paper sets out to do and what kind of contribution it makes, each with the line that shows it.",
  },
  {
    id: "group",
    label: "Group into topics",
    col: 6,
    row: 2,
    note: "Waits for both keyword steps, then gathers related terms into topics. Subject terms and method terms are never mixed, and an acronym joins its long form only where the paper defines it.",
  },
  {
    id: "label",
    label: "Name the topics",
    col: 7,
    row: 2,
    note: "Names every topic in two to five words, each distinct within the paper.",
  },
  {
    id: "classify",
    label: "Category",
    col: 8,
    row: 2,
    note: "Places the paper in your repository’s categories: one main and up to two more, each with a written reason. Skipped in a General repository.",
  },
  {
    id: "typology",
    label: "Kind of study",
    col: 8,
    row: 3,
    note: "Intervention, measurement, review or theory, and so on, worded for your repository’s profile.",
  },
  {
    id: "save",
    label: "Save",
    col: 9,
    row: 2,
    note: "Waits for every branch, then writes the paper in one transaction, with a note on anything that had to fall back. Afterwards a duplicate check, and the paper is indexed for chat.",
  },
];

const COLUMNS = 9;
// Step 0 waits, steps 1-9 are the columns, step 10 is done (and stays).
const DURATIONS = [400, 450, 500, 450, 500, 1100, 600, 550, 800, 700, 99999];

export default function PipelineTimeline() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.4 });
  const [started, setStarted] = useState(false);
  const [step, setStep] = useSequence(DURATIONS, started && motionOK, false);

  useEffect(() => {
    if (onScreen && motionOK) setStarted(true);
  }, [onScreen, motionOK]);

  // The column the cursor is on; 0 before it starts, COLUMNS + 1 when done.
  const column = motionOK ? Math.min(step, COLUMNS + 1) : COLUMNS + 1;
  const running = column >= 1 && column <= COLUMNS;

  const byColumn = Array.from({ length: COLUMNS }, (_, index) => STEPS.filter((item) => item.col === index + 1));

  return (
    <div ref={ref}>
      {/* Wide: the steps in time */}
      <div className="relative hidden lg:block">
        <div className="relative grid grid-cols-9 grid-rows-[repeat(4,64px)] gap-x-2.5 gap-y-2.5">
          {/* column guides */}
          {Array.from({ length: COLUMNS }, (_, index) => (
            <span
              key={index}
              aria-hidden="true"
              style={{ gridColumn: index + 1, gridRow: "1 / span 4" }}
              className={`rounded-xl transition-colors duration-300 ${index + 1 === column ? "bg-accent/[0.06]" : ""}`}
            />
          ))}
          {/* the trunk line through row 2 */}
          <span aria-hidden="true" className="pointer-events-none absolute left-6 right-6 top-[106px] h-px bg-hairline-strong" />
          {STEPS.map((item) => {
            const state = item.col < column ? "done" : item.col === column ? "on" : "next";
            return (
              <div key={item.id} style={{ gridColumn: item.col, gridRow: item.row }} className="relative min-w-0">
                <Hotspot
                  label={item.label}
                  title={item.label}
                  side={item.row >= 3 ? "top" : "bottom"}
                  align={item.col <= 2 ? "start" : item.col >= 8 ? "end" : "center"}
                  className="!flex h-full w-full"
                  buttonClassName={(open) =>
                    `flex h-full w-full items-center justify-center rounded-xl border px-2 text-center text-[12.5px] font-medium leading-tight transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-out-expo ${
                      open
                        ? "border-ink bg-ink text-canvas"
                        : state === "on"
                          ? "-translate-y-0.5 border-ink bg-surface text-ink shadow-float"
                          : state === "done"
                            ? "border-hairline-strong bg-surface text-ink hover:border-ink/40"
                            : "border-hairline bg-surface text-mute hover:text-ink"
                    } ${item.optional ? "border-dashed" : ""}`
                  }
                  trigger={
                    <span>
                      {item.label}
                      {item.optional ? <span className="mt-0.5 block text-[10.5px] font-normal opacity-70">if needed</span> : null}
                    </span>
                  }
                >
                  {item.note}
                </Hotspot>
              </div>
            );
          })}
        </div>
        {/* the time axis */}
        <div className="relative mt-5 h-6">
          <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" aria-hidden="true" />
          <motion.span
            aria-hidden="true"
            className="absolute top-0 h-6 w-px bg-accent"
            initial={false}
            animate={{ left: `${(Math.max(0.5, Math.min(column, COLUMNS) - 0.5) / COLUMNS) * 100}%`, opacity: running ? 1 : 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          />
          <span className="absolute left-0 top-7 text-[12px] text-mute">PDF in</span>
          <span className="absolute right-0 top-7 text-[12px] text-mute">Saved, usually 1–3 minutes later</span>
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] text-mute">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-5 rounded border border-hairline-strong bg-surface" /> Steps in one column run at the same time
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-5 rounded border border-dashed border-hairline-strong" /> Runs only when needed
          </span>
          <span>Open any step for what it does.</span>
          {column > COLUMNS && motionOK ? (
            <button
              type="button"
              onClick={() => setStep(0)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <PlayIcon className="h-3.5 w-3.5" /> Run it again
            </button>
          ) : null}
        </div>
      </div>

      {/* Narrow: the same steps as a list */}
      <ol className="space-y-3 lg:hidden">
        {byColumn.map((group, index) => (
          <li key={index} className="rounded-2xl border border-hairline bg-surface p-4">
            <p className="flex items-baseline gap-3">
              <span className="font-mono text-[12px] tabular-nums text-mute">{String(index + 1).padStart(2, "0")}</span>
              <span className="text-[15px] font-medium text-ink">
                {group.length > 1 ? "At the same time" : group[0].label}
                {group.length === 1 && group[0].optional ? <span className="ml-2 text-[12px] font-normal text-mute">if needed</span> : null}
              </span>
            </p>
            {group.length > 1 ? (
              <ul className="mt-3 space-y-3 border-l border-hairline-strong pl-4">
                {group.map((item) => (
                  <li key={item.id}>
                    <p className="text-[14px] font-medium text-ink">{item.label}</p>
                    <p className="mt-1 text-[13.5px] leading-6 text-body">{item.note}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 pl-8 text-[13.5px] leading-6 text-body">{group[0].note}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { FileIcon, ImageIcon, StackIcon, TranslateIcon } from "@/components/ui/Icons";

/*
 * What real PDFs throw at the analysis, and what it does about each
 * (extractor.py, cleaner.py, translator.py, segmentation.py, duplicates.py).
 * Four tiles of different weights, each with one small movement that plays
 * when the grid is seen. Under reduced motion each tile shows its end state.
 */

function Tile({
  className = "",
  Icon,
  title,
  body,
  children,
}: {
  className?: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-[22px] border border-hairline bg-surface ${className}`}>
      <div className="relative flex-1 border-b border-hairline bg-canvas/60 p-5 dark:bg-black/30" aria-hidden="true">
        {children}
      </div>
      <div className="p-6">
        <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
          <Icon className="h-4 w-4 text-body" />
          {title}
        </p>
        <p className="mt-2 text-[14.5px] leading-6 text-body">{body}</p>
      </div>
    </div>
  );
}

const SCAN_LINES = [
  "Mangroves and seawalls: household choices",
  "in Semarang",
  "We surveyed 412 households in six coastal",
  "neighbourhoods between March and June 2021.",
];

export default function MessyPdfs() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.25 });
  const on = onScreen || !motionOK;
  const [thai, setThai] = useState(true);

  useEffect(() => {
    if (!on || !motionOK) {
      setThai(false);
      return;
    }
    const timer = window.setTimeout(() => setThai(false), 1600);
    return () => window.clearTimeout(timer);
  }, [on, motionOK]);

  return (
    <div ref={ref} className="grid grid-cols-1 gap-4 md:grid-cols-6">
      <Tile
        className="md:col-span-4"
        Icon={ImageIcon}
        title="Scanned pages"
        body="A page with no text layer, a scanned cover or a whole scanned thesis, is read by a vision model. A typed paper with one scanned page gets OCR on that page alone."
      >
        <div className="mx-auto max-w-md space-y-2.5 py-3 font-serif text-[15px] text-ink">
          {SCAN_LINES.map((line, index) => (
            <motion.p
              key={line}
              initial={motionOK ? { filter: "blur(5px)", opacity: 0.45 } : false}
              animate={on ? { filter: "blur(0px)", opacity: 1 } : {}}
              transition={{ duration: 0.9, delay: motionOK ? 0.25 + index * 0.25 : 0, ease: EASE }}
              className={index < 2 ? "text-[17px] font-semibold" : "text-body"}
            >
              {line}
            </motion.p>
          ))}
        </div>
        <span className="absolute right-4 top-4 rounded-full bg-surface px-2.5 py-1 font-mono text-[11px] text-mute shadow-raise">page 1 · image only</span>
      </Tile>

      <Tile
        className="md:col-span-2"
        Icon={TranslateIcon}
        title="Thai papers"
        body="Translated for the analysis when most of the text is not in Latin script. Thai headings, keyword lists and Buddhist-era years are read as they are."
      >
        <div className="flex h-full min-h-[132px] items-center justify-center text-center">
          <AnimatePresence mode="wait" initial={false}>
            {thai ? (
              <motion.p key="th" lang="th" exit={{ opacity: 0, y: -6, filter: "blur(3px)" }} transition={{ duration: 0.35 }} className="text-[17px] leading-8 text-ink">
                การฟื้นฟูป่าชายเลนช่วยลดความเสียหายจากน้ำท่วม
              </motion.p>
            ) : (
              <motion.p
                key="en"
                initial={motionOK ? { opacity: 0, y: 6, filter: "blur(3px)" } : false}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.45, ease: EASE }}
                className="text-[16px] leading-7 text-ink"
              >
                Restoring mangroves reduced flood damage.
                <span className="mt-1 block text-[12px] text-mute">Translated for the analysis</span>
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </Tile>

      <Tile
        className="md:col-span-3"
        Icon={FileIcon}
        title="Long theses"
        body="A model reads the outline of headings, whatever the author called them, and finds the introduction, literature review, methods, results and conclusion of a thesis hundreds of pages long."
      >
        <ol className="space-y-1.5 text-[13.5px]">
          {[
            ["1 Introduction", "introduction"],
            ["2 Literature review", "literature review"],
            ["3 Methodology", "methods"],
            ["4 Findings", "results"],
            ["5 Conclusion", "conclusion"],
          ].map(([heading, section], index) => (
            <motion.li
              key={heading}
              initial={motionOK ? { opacity: 0, x: -6 } : false}
              animate={on ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.4, delay: motionOK ? 0.2 + index * 0.12 : 0, ease: EASE }}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-1.5 text-ink shadow-raise"
            >
              <span>{heading}</span>
              <span className="text-[11px] text-mute">read as {section}</span>
            </motion.li>
          ))}
        </ol>
      </Tile>

      <Tile
        className="md:col-span-3"
        Icon={StackIcon}
        title="The same paper twice"
        body="After each paper is saved, its wording is compared with the papers beside it. A near-identical copy is flagged on the dashboard; nothing is deleted."
      >
        <div className="relative mx-auto h-[150px] max-w-[300px]">
          {/* The first copy, behind: only its file name shows. */}
          <div className="absolute inset-x-6 top-1 rounded-xl border border-hairline bg-surface px-3 pb-10 pt-2 shadow-raise">
            <p className="font-mono text-[10.5px] text-mute">semarang-final.pdf</p>
          </div>
          {/* The second copy slides over it. */}
          <motion.div
            initial={motionOK ? { y: 34, opacity: 0.6 } : false}
            animate={on ? { y: 0, opacity: 1 } : {}}
            transition={{ duration: 0.9, delay: motionOK ? 0.3 : 0, ease: EASE }}
            className="absolute inset-x-3 top-7 rounded-xl border border-hairline-strong bg-surface p-3 shadow-float"
          >
            <p className="text-[12.5px] font-medium leading-snug text-ink">Mangroves and seawalls: household choices in Semarang</p>
            <p className="mt-1 font-mono text-[10.5px] text-mute">semarang-final (1).pdf</p>
          </motion.div>
          <motion.span
            initial={motionOK ? { opacity: 0, scale: 0.9 } : false}
            animate={on ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.4, delay: motionOK ? 1.1 : 0, ease: EASE }}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[rgb(250_204_21/0.22)] px-3 py-1 text-[12px] font-medium text-ink ring-1 ring-[rgb(234_179_8/0.5)]"
          >
            A second copy · flagged
          </motion.span>
        </div>
      </Tile>
    </div>
  );
}

"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import Hotspot from "@/components/marketing/kit/Hotspot";
import { EASE, useMotionOK, useOnScreen, useSequence } from "@/components/marketing/kit/motion";
import { CheckIcon, CloseIcon, RefreshIcon } from "@/components/ui/Icons";

/*
 * Grounded keywords, as the keyword step really keeps them
 * (nodes/keyword_extractor.py, participants.py): a model proposes terms, and
 * each is tested against the paper's own text. Found terms are kept with a
 * counted frequency and the sentence they appear in; a term the paper never
 * uses, or one that only names who took part, is dropped.
 *
 * The terms are tested one after another when the figure is seen. A kept term
 * opens its sentence. The sample paper is invented (fixtures.json).
 */

type Term = { term: string; kind: "subject" | "method"; count?: number; quote?: string; dropped?: string };

const TERMS: Term[] = [
  { term: "mangrove cover", kind: "subject", count: 14, quote: "Households living within 500 metres of restored mangrove cover reported 38 percent less flood damage than those behind the seawall." },
  { term: "blue carbon", kind: "subject", dropped: "Not in the paper" },
  { term: "seawall", kind: "subject", count: 11, quote: "Residents valued the seawall for the certainty it gave, but most expected it to need raising again within fifteen years." },
  { term: "flood exposure", kind: "subject", count: 9, quote: "Flood exposure was highest in the northern kampungs, where land subsidence exceeds eight centimetres a year." },
  { term: "land subsidence", kind: "subject", count: 7, quote: "Land subsidence, driven by groundwater extraction, doubled the area flooded by ordinary spring tides between 2010 and 2020." },
  { term: "Semarang households", kind: "subject", dropped: "Only names who took part" },
  { term: "willingness to pay", kind: "subject", count: 6, quote: "Willingness to pay for mangrove protection rose when households had seen restored belts reduce wave height." },
  { term: "community participation", kind: "subject", count: 6, quote: "Community participation in replanting was strongest where fishing groups kept the right to harvest shellfish." },
  { term: "risk perception", kind: "subject", count: 5, quote: "Risk perception fell sharply among families who had lived behind the seawall for more than a decade." },
  { term: "household survey", kind: "method", count: 4, quote: "We surveyed 412 households in six coastal neighbourhoods between March and June 2021." },
];

const DURATIONS = [400, ...TERMS.map(() => 420), 99999];

export default function KeywordGrounding() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.4 });
  const [started, setStarted] = useState(false);
  const [step, setStep] = useSequence(DURATIONS, started && motionOK, false);

  useEffect(() => {
    if (onScreen && motionOK) setStarted(true);
  }, [onScreen, motionOK]);

  const tested = motionOK ? Math.max(0, Math.min(TERMS.length, step)) : TERMS.length;
  const kept = TERMS.slice(0, tested).filter((term) => !term.dropped).length;
  const dropped = tested - kept;

  return (
    <div ref={ref} className="rounded-[24px] border border-hairline bg-surface p-5 shadow-raise sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline pb-4">
        <p className="text-[14px] text-body">
          Proposed by the model: <span className="font-medium tabular-nums text-ink">{TERMS.length}</span>
        </p>
        <p className="font-mono text-[12.5px] tabular-nums text-mute" aria-live="polite">
          kept {kept} · dropped {dropped}
        </p>
      </div>
      <ul className="mt-5 flex flex-wrap gap-2.5">
        {TERMS.map((item, index) => {
          const state = index >= tested ? "waiting" : item.dropped ? "dropped" : "kept";
          if (state === "kept") {
            return (
              <li key={item.term}>
                <Hotspot
                  label={item.term}
                  title={`“${item.term}”, ${item.count} times${item.kind === "method" ? " · a method" : ""}`}
                  side="top"
                  align={index % 4 === 3 ? "end" : "start"}
                  buttonClassName={(open) =>
                    `inline-flex items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3 text-[13.5px] transition-colors duration-200 ${
                      open ? "border-ink bg-ink text-canvas" : "border-hairline-strong bg-surface text-ink hover:border-ink/40"
                    }`
                  }
                  trigger={
                    <motion.span
                      className="inline-flex items-center gap-2"
                      initial={motionOK ? { opacity: 0.4 } : false}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, ease: EASE }}
                    >
                      <CheckIcon weight="bold" className="h-3.5 w-3.5" />
                      {item.term}
                      <span className="font-mono text-[11.5px] tabular-nums opacity-60">×{item.count}</span>
                    </motion.span>
                  }
                >
                  <span className="italic">“{item.quote}”</span>
                </Hotspot>
              </li>
            );
          }
          return (
            <li key={item.term}>
              <span
                className={`inline-flex items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3 text-[13.5px] transition-[opacity,color,border-color] duration-300 ${
                  state === "dropped" ? "border-dashed border-hairline-strong text-mute" : "border-hairline text-mute opacity-60"
                }`}
              >
                {state === "dropped" ? <CloseIcon className="h-3.5 w-3.5" /> : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-hairline-strong" />}
                <span className={state === "dropped" ? "line-through decoration-1" : ""}>{item.term}</span>
                {state === "dropped" ? <span className="text-[11.5px]">{item.dropped}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[13px] text-mute">
        <span>Open a kept term for the sentence it was found in.</span>
        {tested >= TERMS.length && motionOK ? (
          <button
            type="button"
            onClick={() => setStep(0)}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RefreshIcon className="h-3.5 w-3.5" /> Test them again
          </button>
        ) : null}
      </div>
    </div>
  );
}

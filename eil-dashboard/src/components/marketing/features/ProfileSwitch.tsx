"use client";

import { motion } from "framer-motion";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import Hotspot from "@/components/marketing/kit/Hotspot";
import { EASE, useMotionOK } from "@/components/marketing/kit/motion";

/*
 * A repository's analysis profile (project-analysis-profile.ts): no forced
 * categories, the official EIL tracks with their boundary rule, or a taxonomy
 * of your own. Switching shows where the same kind of papers land, and every
 * placed paper opens the reason it was placed there.
 *
 * The EIL panel uses applied-linguistics papers and the custom panel the
 * coastal sample collection, so both kinds of field appear. All titles are
 * invented.
 */

const PROFILES = [
  { key: "general", label: "General" },
  { key: "eil", label: "EIL tracks" },
  { key: "custom", label: "Your own" },
] as const;

type Profile = (typeof PROFILES)[number]["key"];

type Placed = { title: string; reason: string };

const EIL: Array<{ code: string; name: string; papers: Placed[] }> = [
  {
    code: "EL",
    name: "English Linguistics",
    papers: [{ title: "Discourse markers in Thai university lectures", reason: "Its contribution is an account of how English is used in lectures, not a way of teaching or testing it." }],
  },
  {
    code: "ELI",
    name: "English Language Instruction",
    papers: [{ title: "Peer feedback in Thai EFL writing classrooms", reason: "An instructional intervention. It belongs here even though tests measured the outcome: that is the boundary rule." }],
  },
  {
    code: "LAE",
    name: "Language Assessment & Evaluation",
    papers: [{ title: "Validating a computerised dynamic reading test", reason: "It primarily builds and validates an assessment." }],
  },
];

const CUSTOM: Array<{ name: string; papers: Placed[] }> = [
  {
    name: "Adaptation strategies",
    papers: [
      { title: "Mangroves and seawalls: household choices in Semarang", reason: "It compares two ways of adapting to flooding, in its survey design and its findings." },
      { title: "Managed retreat: a study of Semarang", reason: "Its subject is moving households away from the coast as an adaptation." },
    ],
  },
  {
    name: "Governance and finance",
    papers: [{ title: "Rethinking adaptation finance in Dar es Salaam", reason: "Its contribution is how adaptation is paid for and decided." }],
  },
  {
    name: "Hazards and risk",
    papers: [
      { title: "Storm surge modelling and early warning systems", reason: "It models the hazard itself, before any response to it." },
      { title: "Rethinking coastal land subsidence in Colombo", reason: "It measures how sinking land changes flood risk." },
    ],
  },
];

function PaperChip({ paper, index, side = "top" }: { paper: Placed; index: number; side?: "top" | "bottom" }) {
  const motionOK = useMotionOK();
  return (
    <motion.li
      initial={motionOK ? { opacity: 0, y: -18, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, delay: motionOK ? 0.12 + index * 0.1 : 0, ease: EASE }}
    >
      <Hotspot
        label={paper.title}
        title="Why it was placed here"
        side={side}
        align="start"
        className="!flex w-full"
        buttonClassName={(open) =>
          `w-full rounded-xl border px-3 py-2.5 text-left text-[13px] leading-snug transition-colors duration-200 ${
            open ? "border-ink bg-ink text-canvas" : "border-hairline bg-surface text-ink shadow-raise hover:border-hairline-strong"
          }`
        }
        trigger={<span>{paper.title}</span>}
      >
        {paper.reason}
      </Hotspot>
    </motion.li>
  );
}

export default function ProfileSwitch() {
  const id = useId();
  const [profile, setProfile] = useState<Profile>("custom");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = PROFILES.findIndex((item) => item.key === profile);
    const next = event.key === "ArrowRight" ? (index + 1) % PROFILES.length : event.key === "ArrowLeft" ? (index + PROFILES.length - 1) % PROFILES.length : null;
    if (next === null) return;
    event.preventDefault();
    setProfile(PROFILES[next].key);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Analysis profile" onKeyDown={onKey} className="inline-flex rounded-full border border-hairline bg-surface p-1">
        {PROFILES.map((item, index) => {
          const on = item.key === profile;
          return (
            <button
              key={item.key}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              role="tab"
              id={`${id}-${item.key}`}
              aria-selected={on}
              aria-controls={`${id}-${item.key}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setProfile(item.key)}
              className={`h-9 rounded-full px-4 text-[14px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${on ? "bg-ink text-canvas" : "text-body hover:text-ink"}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-8 min-h-[300px]">
        <div role="tabpanel" id={`${id}-general-panel`} aria-labelledby={`${id}-general`} hidden={profile !== "general"} className="motion-safe:animate-rise-in">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <p className="text-[16px] leading-7 text-body">
              No research areas forced on the papers. Each is described by its topics, its methods and its kind of study, and the
              dashboard groups them into themes. No classification step runs, so nothing is squeezed into a box it does not fit.
            </p>
            <div className="flex flex-wrap gap-2" aria-hidden="true">
              {["Mangrove restoration", "Household surveys", "Managed retreat", "Coastal flood risk mapping", "Adaptation finance", "Storm surge modelling", "Remote sensing analysis"].map((topic) => (
                <span key={topic} className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-[13px] text-body">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div role="tabpanel" id={`${id}-eil-panel`} aria-labelledby={`${id}-eil`} hidden={profile !== "eil"}>
          {profile === "eil" ? (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {EIL.map((track, column) => (
                  <div key={track.code} className="rounded-2xl border border-hairline bg-canvas/60 p-4 dark:bg-surface/60">
                    <p className="text-[14px] font-medium text-ink">
                      <span className="mr-2 font-mono text-[12px] text-mute">{track.code}</span>
                      {track.name}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {track.papers.map((paper) => (
                        <PaperChip key={paper.title} paper={paper} index={column} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-5 max-w-3xl text-[14px] leading-6 text-mute">
                The official tracks of English as an International Language, with the rule that settles the hard cases: a
                teaching intervention is ELI even when a test measures its outcome.
              </p>
            </>
          ) : null}
        </div>

        <div role="tabpanel" id={`${id}-custom-panel`} aria-labelledby={`${id}-custom`} hidden={profile !== "custom"}>
          {profile === "custom" ? (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {CUSTOM.map((category, column) => (
                  <div key={category.name} className="rounded-2xl border border-hairline bg-canvas/60 p-4 dark:bg-surface/60">
                    <p className="text-[14px] font-medium text-ink">{category.name}</p>
                    <ul className="mt-3 space-y-2">
                      {category.papers.map((paper, row) => (
                        <PaperChip key={paper.title} paper={paper} index={column + row * 3} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-5 max-w-3xl text-[14px] leading-6 text-mute">
                Two to twelve research areas you name and describe, plus “Other / Unclassified” for what fits none. A paper gets one
                main research area and up to two more, each with its reason.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

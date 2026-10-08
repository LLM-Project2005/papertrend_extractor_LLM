"use client";

import { LayoutGroup, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DEMO_THEMES } from "@/components/marketing/demo-data";
import { EASE, useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { CheckIcon } from "@/components/ui/Icons";

/*
 * Topics become themes (src/lib/topic-themes.ts): different papers name the
 * same subject differently, so the dashboard groups their topics before it
 * counts. Three separate passes propose groupings and a merge stands only
 * where they agree; method topics become themes of their own.
 *
 * The names start mixed together; three passes tick; then every name glides
 * into its theme. A button puts them back. Under reduced motion the themes are
 * shown already grouped.
 */

const THEMES = [
  ...DEMO_THEMES.map((theme) => ({ ...theme, method: false })),
  { theme: "Household surveys", papers: 7, spellings: ["household survey", "questionnaire of residents", "door-to-door interviews"], method: true },
];

// Mixed order for the ungrouped state: one name from each theme in turn.
const MIXED = THEMES[0].spellings.flatMap((_, row) => THEMES.map((theme) => ({ name: theme.spellings[row], theme: theme.theme })));

export default function ThemeMerge() {
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.45 });
  const [grouped, setGrouped] = useState(false);
  const [passes, setPasses] = useState(0);

  useEffect(() => {
    if (!motionOK) {
      setGrouped(true);
      setPasses(3);
      return;
    }
    if (!onScreen) return;
    const timers = [700, 1100, 1500].map((ms, index) => window.setTimeout(() => setPasses(index + 1), ms));
    timers.push(window.setTimeout(() => setGrouped(true), 2000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onScreen, motionOK]);

  const toggle = () => {
    if (grouped) {
      setGrouped(false);
      setPasses(0);
    } else {
      setPasses(3);
      setGrouped(true);
    }
  };

  const chip = (name: string) => (
    <motion.li
      key={name}
      layoutId={`theme-chip-${name}`}
      transition={{ duration: motionOK ? 0.8 : 0, ease: EASE }}
      className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-[13.5px] text-ink shadow-raise"
    >
      {name}
    </motion.li>
  );

  return (
    <div ref={ref} className="rounded-[26px] border border-hairline bg-canvas/60 p-5 dark:bg-surface/50 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ol className="flex flex-wrap gap-2" aria-label="Grouping passes">
          {[1, 2, 3].map((pass) => (
            <li
              key={pass}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] transition-colors duration-300 ${
                passes >= pass ? "bg-ink text-canvas" : "bg-subtle text-mute"
              }`}
            >
              {passes >= pass ? <CheckIcon weight="bold" className="h-3 w-3" /> : null}
              Pass {pass}
            </li>
          ))}
          <li className="self-center pl-1 text-[12.5px] text-mute">{passes >= 3 ? "merges kept where the passes agree" : "grouping…"}</li>
        </ol>
        <button
          type="button"
          onClick={toggle}
          className="rounded-full border border-hairline-strong bg-surface px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {grouped ? "Show the raw topic names" : "Group them"}
        </button>
      </div>

      <LayoutGroup>
        <div className="mt-8 min-h-[260px]" aria-live="polite">
          {grouped ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {THEMES.map((theme) => (
                <motion.section
                  key={theme.theme}
                  initial={motionOK ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, ease: EASE }}
                  className={`rounded-2xl border p-4 ${theme.method ? "border-dashed border-hairline-strong" : "border-hairline bg-surface"}`}
                  aria-label={theme.theme}
                >
                  <p className="text-[15px] font-medium text-ink">{theme.theme}</p>
                  <p className="mt-0.5 text-[12.5px] text-mute">
                    {theme.papers} papers{theme.method ? " · a method, kept apart" : ""}
                  </p>
                  <ul className="mt-4 flex flex-col items-start gap-2">{theme.spellings.map(chip)}</ul>
                </motion.section>
              ))}
            </div>
          ) : (
            <ul className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2.5 py-6">{MIXED.map((item) => chip(item.name))}</ul>
          )}
        </div>
      </LayoutGroup>
    </div>
  );
}

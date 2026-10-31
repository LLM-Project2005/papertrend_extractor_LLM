"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ANALYSIS_STEP_COUNT,
  SAMPLE_MERGES,
  SAMPLE_PHRASES,
  SAMPLE_TOPICS,
  TOPIC_STAGES,
  type TopicStageKey,
} from "@/components/marketing/how-it-works-content";
import { DEMO_PAPER } from "@/components/marketing/demo-data";
import { useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import { buttonClass } from "@/components/ui/controls";
import { ArrowRightIcon, CheckCircleIcon, CheckIcon, PauseIcon, PlayIcon } from "@/components/ui/Icons";

/*
 * How one paper's topics are made, and then agreed across papers, as six
 * stages (facts: how-it-works-content.ts). Each stage is a tab: what it does
 * and what code checks on the left, an illustrative window on the right that
 * plays when the stage is shown.
 *
 * Seen for the first time, the stages play through once, a bar filling under
 * the one on show; Pause stops it, and choosing a stage takes over. It holds,
 * bar and all, while the pointer is over the stages or keyboard focus is
 * inside them, and goes on afterwards. Every stage's words are in the page;
 * only the chosen one is shown. Under reduced motion nothing plays, and each
 * window is its finished state.
 *
 * One frame only (2026-10-31, UI audit): the chosen stage is not a card, so
 * its illustrative window is the one frame on the page.
 */

const STAGE_MS = 8000;

const delay = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });

/* ------------------------------------------------------------- pieces */

/** Held while the pointer is over the stages or keyboard focus is inside them. */
function useHold() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const handlers = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    },
  };
  return [hovered || focused, handlers] as const;
}

function Checked({ title = "Checked by code", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-xl bg-subtle px-4 py-3.5">
      <p className="text-xs font-medium text-mute">{title}</p>
      <p className="mt-1.5 text-[14px] leading-6 text-ink">{children}</p>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <li className="rounded-full border border-hairline px-3 py-1.5 text-[13px] text-ink">{children}</li>;
}

function Window({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-hairline bg-surface shadow-float">
      <p className="border-b border-hairline px-4 py-2.5 text-xs text-mute">{tag}</p>
      {children}
    </div>
  );
}

function Marked({ text, mark, at }: { text: string; mark: string; at: number }) {
  const start = text.indexOf(mark);
  if (start < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <span className="mark-sweep text-ink" style={delay(at)}>
        {mark}
      </span>
      {text.slice(start + mark.length)}
    </>
  );
}

/* ------------------------------------------------------------ windows */

function ReadWindow() {
  const lines = [
    { tag: "Abstract", text: "This study asks how households choose between hard defences and restored mangroves." },
    { tag: "Methods", text: "We surveyed 412 households in six coastal neighbourhoods." },
    { tag: "Results", text: "Households near restored mangrove cover reported 38 percent less flood damage." },
    { tag: "Conclusion", text: "The wall buys time while the mangroves grow." },
  ];
  return (
    <Window tag="Illustrative">
      <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,5fr)]">
        <div className="flex flex-row flex-wrap gap-1.5 self-start text-[11px] text-mute sm:flex-col" aria-hidden="true">
          {["Abstract", "Introduction", "Literature review", "Methods", "Results", "Conclusion"].map((name) => (
            <span key={name} className="rounded-md bg-subtle px-2 py-1">
              {name}
            </span>
          ))}
        </div>
        <div>
          <ul className="divide-y divide-hairline">
            {lines.map((line, index) => (
              <li
                key={line.tag}
                className="enter-fly flex items-baseline gap-2.5 py-2 text-[13px] leading-5 text-ink"
                style={delay(0.3 + index * 0.45)}
              >
                <span
                  className={`flex-none rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    index === 0 ? "bg-accent-soft text-accent-ink" : "bg-subtle text-ink"
                  }`}
                >
                  {line.tag}
                </span>
                {line.text}
              </li>
            ))}
          </ul>
          <div className="enter-up mt-3 rounded-lg bg-subtle p-3 text-[13px] leading-5" style={delay(2.3)}>
            <p lang="th" className="text-body">
              กำแพงกันคลื่นช่วยซื้อเวลา ระหว่างที่ป่าชายเลนเติบโต
            </p>
            <p className="mt-1.5 flex items-baseline gap-2 text-ink">
              <span className="flex-none whitespace-nowrap text-[11px] font-medium text-accent-ink">TH → EN</span>
              The wall buys time while the mangroves grow.
            </p>
          </div>
        </div>
      </div>
    </Window>
  );
}

function FindWindow() {
  const paragraph: Array<string | { mark: string }> = [
    "Households living within 500 metres of restored ",
    { mark: "mangrove cover" },
    " reported 38 percent less flood damage than those behind the ",
    { mark: "seawall" },
    ". ",
    { mark: "Flood exposure" },
    " was highest in the northern kampungs, where ",
    { mark: "land subsidence" },
    " exceeds eight centimetres a year. ",
    { mark: "Community participation" },
    " in replanting was strongest where fishing groups kept the right to harvest shellfish.",
  ];
  let marks = 0;
  return (
    <Window tag="Illustrative">
      <div className="space-y-5 p-5">
        <p className="text-[14.5px] leading-7 text-body">
          {paragraph.map((part, index) =>
            typeof part === "string" ? (
              <span key={index}>{part}</span>
            ) : (
              <span key={index} className="mark-sweep text-ink" style={delay(0.3 + marks++ * 0.45)}>
                {part.mark}
              </span>
            )
          )}
        </p>
        <ul className="grid grid-cols-1 gap-1.5 border-t border-hairline pt-4 text-[12px] sm:grid-cols-2">
          {SAMPLE_PHRASES.map((item, index) => (
            <li
              key={item.phrase}
              className="enter-pop flex items-center justify-between gap-2 rounded-md bg-subtle px-2.5 py-1.5 text-ink"
              style={delay(0.6 + index * 0.2)}
            >
              <span className="truncate">
                {item.phrase}
                {item.kind === "method" ? <span className="ml-1.5 text-mute">method</span> : null}
              </span>
              <span className="flex-none tabular-nums text-accent-ink">×{item.count}</span>
            </li>
          ))}
        </ul>
        <p className="enter-up flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px] text-mute" style={delay(2.7)}>
          <span className="text-body line-through">blue carbon</span>
          proposed by the model, not in the paper: dropped
        </p>
      </div>
    </Window>
  );
}

function GroupWindow() {
  return (
    <Window tag="Illustrative">
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {SAMPLE_TOPICS.map((topic, group) => (
            <div key={topic.name} className="flex flex-col gap-1.5 border-t border-hairline pt-3">
              <p className="text-[11px] font-medium text-mute">{topic.kind === "method" ? "Method" : `Topic ${"ABC"[group]}`}</p>
              <ul className="flex flex-wrap gap-1.5">
                {topic.phrases.map((phrase, index) => (
                  <li
                    key={phrase}
                    className={`enter-fly rounded-full px-2.5 py-1 text-[12px] ${
                      topic.kind === "method" ? "bg-subtle text-ink" : "bg-accent-soft text-accent-ink"
                    }`}
                    style={delay(0.2 + group * 0.25 + index * 0.3)}
                  >
                    {phrase}
                  </li>
                ))}
              </ul>
              <p className="enter-up mt-1 text-[12px] leading-[18px] text-body" style={delay(1.9 + group * 0.2)}>
                “<Marked text={topic.evidence} mark={topic.mark} at={2.3 + group * 0.2} />”
              </p>
            </div>
          ))}
        </div>
        <p className="enter-up flex items-center gap-2 text-[12.5px] text-ink" style={delay(3.1)}>
          <CheckIcon className="h-3.5 w-3.5" /> Every phrase in exactly one topic, the method kept apart
        </p>
      </div>
    </Window>
  );
}

function NameWindow() {
  return (
    <Window tag="Illustrative">
      <div className="space-y-3 p-5">
        {SAMPLE_TOPICS.map((topic, index) => (
          <div key={topic.name} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] sm:gap-3">
            <ul className="flex flex-wrap gap-1.5">
              {topic.phrases.map((phrase) => (
                <li
                  key={phrase}
                  className={`rounded-full px-2.5 py-1 text-[12px] ${topic.kind === "method" ? "bg-subtle text-ink" : "bg-accent-soft text-accent-ink"}`}
                >
                  {phrase}
                </li>
              ))}
            </ul>
            <ArrowRightIcon className="hidden h-5 w-5 text-mute sm:block" />
            <p
              className="enter-pop flex items-baseline justify-between gap-2 rounded-lg bg-subtle px-3.5 py-2.5 text-[15px] font-semibold tracking-[-0.01em] text-ink"
              style={delay(0.5 + index * 0.55)}
            >
              {topic.name}
              {topic.kind === "method" ? <span className="text-[11px] font-normal text-mute">method</span> : null}
            </p>
          </div>
        ))}
        <p className="enter-up flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-3 text-[12px] text-body" style={delay(2.9)}>
          <span>2 to 5 words</span>
          <span>All different</span>
          <span>{SAMPLE_TOPICS.length} topics</span>
        </p>
      </div>
    </Window>
  );
}

const RULES = [
  { rule: "Every kept phrase appears in the paper", tag: "grounding" },
  { rule: "Every count is counted in the text", tag: "counting" },
  { rule: "Every phrase sits in exactly one topic", tag: "coverage" },
  { rule: "No topic mixes a subject with a method", tag: "kinds" },
  { rule: "Every name is 2 to 5 words, and different", tag: "naming" },
];

function CheckWindow() {
  return (
    <Window tag="Rule-based: no model">
      <ul className="px-5 pb-5 pt-2">
        {RULES.map((item, index) => {
          const at = 0.7 + index * 0.65;
          return (
            <li key={item.tag} className="flex items-center gap-3.5 border-b border-hairline py-3 text-[14px] text-ink">
              <span className="relative flex h-5 w-5 flex-none items-center justify-center" aria-hidden="true">
                <span
                  className="check-wait absolute h-4 w-4 rounded-full border-[1.5px] border-hairline-strong border-t-accent"
                  style={{ animationDelay: `0s, ${at}s` }}
                />
                <span className="enter-pop text-ink" style={delay(at + 0.1)}>
                  <CheckIcon className="h-4 w-4" />
                </span>
              </span>
              <span className="flex-1">{item.rule}</span>
              <span className="hidden text-[11px] text-mute sm:inline">{item.tag}</span>
            </li>
          );
        })}
        <li className="enter-up mt-3 flex items-center gap-2 rounded-lg bg-subtle px-3.5 py-3 text-[13px] font-medium text-ink" style={delay(0.7 + RULES.length * 0.65)}>
          <CheckCircleIcon className="h-4 w-4 flex-none" />
          The rules hold. Saved with {SAMPLE_TOPICS.length} topics and their sentences.
        </li>
      </ul>
    </Window>
  );
}

function AgreeWindow() {
  return (
    <Window tag="Illustrative">
      <div className="p-5">
        {/* On a phone the pair takes a row of its own, and the votes and decision sit beneath it. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-hairline pb-2 text-[11px] font-medium text-mute sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <span className="col-span-2 sm:col-span-1">Topics from different papers</span>
          <span className="hidden w-[76px] text-center sm:block">Groupings</span>
          <span className="hidden w-[84px] text-right sm:block">Decision</span>
        </div>
        <ul>
          {SAMPLE_MERGES.map((merge, row) => {
            const together = merge.votes.filter(Boolean).length;
            const kept = together >= 2;
            return (
              <li
                key={merge.left + merge.right}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 border-b border-hairline py-3 text-[12.5px] sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <span className="col-span-2 flex min-w-0 flex-wrap items-start gap-1 sm:col-span-1 sm:flex-col">
                  <span className="max-w-full truncate rounded-full bg-subtle px-2 py-0.5 text-ink">{merge.left}</span>
                  <span className="max-w-full truncate rounded-full bg-subtle px-2 py-0.5 text-ink">{merge.right}</span>
                </span>
                <span className="flex gap-2 sm:w-[76px] sm:justify-center">
                  <span className="sr-only">Put together by {together} of 3 groupings.</span>
                  {merge.votes.map((vote, column) => (
                    <span
                      key={column}
                      aria-hidden="true"
                      className={`enter-pop h-3 w-3 rounded-full ${vote ? "bg-accent" : "border-[1.5px] border-hairline-strong"}`}
                      style={delay(0.3 + column * 0.55 + row * 0.12)}
                    />
                  ))}
                </span>
                <span
                  className={`enter-pop text-right font-medium sm:w-[84px] ${kept ? "text-ink" : "text-mute line-through"}`}
                  style={delay(2.3 + row * 0.15)}
                >
                  {kept ? "Merged" : "Not merged"}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="enter-up mt-4 text-[12.5px] leading-5 text-body" style={delay(3)}>
          A merge only one grouping made does not survive.
        </p>
      </div>
    </Window>
  );
}

/* ------------------------------------------------------------- panels */

const PANELS: Record<TopicStageKey, { title: string; body: ReactNode; side: ReactNode; Win: () => ReactNode }> = {
  read: {
    title: "Read the paper, and only the paper.",
    body: (
      <>
        Everything after this works from the paper’s own text. The PDF’s text layer is taken page by page; a page without one,
        such as a scanned cover, is read by a vision model. A Thai paper is translated in parts for the analysis, and your PDF is
        never changed. Then a model reads the outline of headings and marks each section.
      </>
    ),
    side: (
      <>
        <dl className="mt-5 space-y-2.5 text-[14px]">
          {[
            ["In", "Your PDF, in English or Thai"],
            ["Out", "Abstract, introduction, literature review, methods, results, conclusion"],
            ["TH → EN", "Translated part by part; a part that fails stays in Thai, with a note"],
          ].map(([term, detail]) => (
            <div key={term} className="flex gap-3">
              <dt className="w-16 flex-none whitespace-nowrap pt-px text-[12px] font-medium text-mute">{term}</dt>
              <dd className="text-ink">{detail}</dd>
            </div>
          ))}
        </dl>
        <Checked>
          Page numbers and broken lines are cleaned away, but a year standing alone on a line is kept. If the model cannot mark
          the sections, heading rules in English and Thai take over.
        </Checked>
      </>
    ),
    Win: ReadWindow,
  },
  find: {
    title: "Phrases copied from the paper, never invented.",
    body: (
      <>
        A model proposes the 12 to 20 concepts the paper studies, its subjects first and at most three methods, each as an exact
        phrase with the sentence it came from. The paper’s own keyword list, when it has one, is read as well.
      </>
    ),
    side: (
      <>
        <ul className="mt-5 flex flex-wrap gap-2">
          <Pill>Exact phrases</Pill>
          <Pill>With their sentence</Pill>
          <Pill>Subject or method</Pill>
          <Pill>Counted by code</Pill>
        </ul>
        <Checked>
          A phrase that is not in the paper is dropped. How often it appears is counted in the text, not estimated. A sentence that
          is not in the paper is swapped for the one where the phrase first appears, and a phrase that only names who took part is
          not kept as a concept.
        </Checked>
      </>
    ),
    Win: FindWindow,
  },
  group: {
    title: "From phrases to topics, with receipts.",
    body: (
      <>
        A model puts every phrase into exactly one group: one concept, its abbreviation or synonym, or tightly connected parts of
        one idea. Each group becomes a topic of the paper and keeps up to six of its sentences as evidence.
      </>
    ),
    side: (
      <Checked>
        A phrase the model leaves out becomes a topic of its own, with a note. A subject and a method never share a topic, and an
        abbreviation joins its long form only where the paper itself defines it.
      </Checked>
    ),
    Win: GroupWindow,
  },
  name: {
    title: "A name, and nothing more.",
    body: (
      <>
        One call names all of a paper’s topics together, with its title and abstract in view. A name is two to five words, built
        from the group’s own phrases, and specific: the concept as this paper uses it, not an umbrella such as “Coastal Issues”. A
        method is named as a method.
      </>
    ),
    side: (
      <>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 text-[13.5px]">
          <div className="border-t border-hairline pt-3">
            <dt className="mb-1.5 text-xs font-medium text-ink">It is</dt>
            <dd className="leading-6 text-ink">
              A naming step
              <br />
              Bound to its phrases
              <br />
              One call per paper
            </dd>
          </div>
          <div className="border-t border-hairline pt-3">
            <dt className="mb-1.5 text-xs font-medium text-mute">It is not</dt>
            <dd className="leading-6 text-body">
              A summary
              <br />
              A source of new ideas
              <br />
              An umbrella term
            </dd>
          </div>
        </dl>
        <Checked>
          A name shorter than two words, longer than five, or the same as another topic’s is replaced by the group’s best phrase,
          with a note.
        </Checked>
      </>
    ),
    Win: NameWindow,
  },
  check: {
    title: "Rules, not opinions.",
    body: (
      <>
        This stage is not a model, and not a step of its own: plain code checks the work inside each stage above, and again when
        the paper is saved. Nothing is passed on as if it were fine. Every fallback is written down with the paper.
      </>
    ),
    side: (
      <Checked title="Where it runs">
        Inside the find, group and name stages, and at the save, which writes the whole paper in one transaction or not at all.
      </Checked>
    ),
    Win: CheckWindow,
  },
  agree: {
    title: "Merged only where independent passes agree.",
    body: (
      <>
        Papers name the same idea differently: “mangrove replanting” in one, “restored mangrove belts” in another. To group topics
        into themes across your repository, three groupings are made independently, and two topics stay together only when at
        least two of the three put them together.
      </>
    ),
    side: (
      <>
        <ul className="mt-5 flex flex-wrap gap-2">
          <Pill>3 independent groupings</Pill>
          <Pill>2 of 3 to merge</Pill>
          <Pill>New papers filed by vote</Pill>
        </ul>
        <Checked title="Where it runs">
          On the dashboard, when its themes are grouped. A new paper’s topics are filed under the existing themes by the same kind
          of vote, and what fits none is grouped afresh.
        </Checked>
      </>
    ),
    Win: AgreeWindow,
  },
};

/* --------------------------------------------------------------- stages */

export default function TopicStages() {
  const id = useId();
  const motionOK = useMotionOK();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.6 });
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  // Bumped each time a stage is shown, so its window plays from the start.
  const [shownAt, setShownAt] = useState(0);
  const begun = useRef(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [held, hold] = useHold();
  // What is left of the stage on show, kept across a hold.
  const remaining = useRef(STAGE_MS);

  useEffect(() => {
    if (!onScreen || !motionOK || begun.current) return;
    begun.current = true;
    setShownAt((value) => value + 1);
    setPlaying(true);
  }, [onScreen, motionOK]);

  // A new showing gets its full time. Declared before the timer, so it runs
  // after the timer's cleanup has counted what the last showing used.
  useEffect(() => {
    remaining.current = STAGE_MS;
  }, [shownAt]);

  useEffect(() => {
    if (!playing || held) return;
    const began = Date.now();
    const timer = window.setTimeout(() => {
      if (stage >= TOPIC_STAGES.length - 1) {
        setPlaying(false);
        setEnded(true);
        return;
      }
      setStage(stage + 1);
      setShownAt((value) => value + 1);
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - began));
    };
  }, [playing, held, stage]);

  const choose = (index: number) => {
    setPlaying(false);
    setEnded(false);
    if (index !== stage) {
      setStage(index);
      setShownAt((value) => value + 1);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = TOPIC_STAGES.length - 1;
    const next =
      event.key === "ArrowRight" ? (stage + 1) % (last + 1)
      : event.key === "ArrowLeft" ? (stage + last) % (last + 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    choose(next);
    tabs.current[next]?.focus();
  };

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (ended || stage >= TOPIC_STAGES.length - 1) {
      setStage(0);
      setEnded(false);
    }
    setShownAt((value) => value + 1);
    setPlaying(true);
  };

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mute">
          <span className="font-medium text-ink">
            Stage {stage + 1} of {TOPIC_STAGES.length}.
          </span>{" "}
          The first five work on one paper; the sixth, across the whole repository.
        </p>
        <button type="button" onClick={toggle} className={buttonClass("secondary", "md")}>
          {playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
          {playing ? "Pause" : ended ? "Play again" : "Play"}
        </button>
      </div>

      <div {...hold}>
        <div ref={ref} role="tablist" aria-label="Stages" onKeyDown={onKey} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {TOPIC_STAGES.map((item, index) => {
            const on = index === stage;
            const done = index < stage;
            return (
              <button
                key={item.key}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${item.key}`}
                aria-selected={on}
                aria-controls={`${id}-panel-${item.key}`}
                tabIndex={on ? 0 : -1}
                onClick={() => choose(index)}
                className={`relative flex min-h-[44px] flex-col gap-1.5 overflow-hidden rounded-xl border bg-surface px-3.5 pb-4 pt-3.5 text-left transition-[border-color,transform] duration-300 ease-out-expo ${
                  on ? "-translate-y-0.5 border-ink shadow-float" : "border-hairline hover:border-hairline-strong"
                }`}
              >
                <span className="flex items-center justify-between text-[12px] tabular-nums text-mute">
                  <span className={on ? "font-medium text-accent-ink" : ""}>{index + 1}</span>
                  <CheckIcon className={`h-3.5 w-3.5 text-ink transition-opacity duration-300 ${done ? "opacity-100" : "opacity-0"}`} />
                </span>
                <span className="text-[14px] font-medium leading-5 text-ink">{item.name}</span>
                <span className="hidden text-[12px] leading-[17px] text-mute sm:block">{item.role}</span>
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5">
                  {on && playing ? (
                    <span
                      key={shownAt}
                      className="stage-fill block h-full bg-accent"
                      style={{ "--stage-ms": `${STAGE_MS}ms`, animationPlayState: held ? "paused" : "running" } as CSSProperties}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        {TOPIC_STAGES.map((item, index) => {
          const on = index === stage;
          const panel = PANELS[item.key];
          return (
            <div
              key={item.key}
              role="tabpanel"
              id={`${id}-panel-${item.key}`}
              aria-labelledby={`${id}-tab-${item.key}`}
              hidden={!on}
              className="mt-10 lg:min-h-[480px]"
            >
              <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-12">
                <div className="enter-up lg:col-span-5">
                  <h3 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[28px]">{panel.title}</h3>
                  <p className="mt-3.5 text-[15px] leading-[26px] text-body">{panel.body}</p>
                  {panel.side}
                </div>
                <div key={on ? shownAt : undefined} className="lg:col-span-7">
                  <panel.Win />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-8 max-w-3xl text-[14.5px] leading-7 text-body">
        Alongside these stages, four more steps date the paper, find its aims and contributions, place it in your categories and
        name the kind of study: {ANALYSIS_STEP_COUNT} steps for each paper (the progress tray groups them into ten), four at a time
        where they can run together. The sample
        paper here is invented: “{DEMO_PAPER.title}”.
      </p>
    </div>
  );
}

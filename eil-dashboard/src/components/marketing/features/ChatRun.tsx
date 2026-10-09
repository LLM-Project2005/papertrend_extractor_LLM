"use client";

import { useEffect, useState } from "react";
import { DEMO_ANSWER, DEMO_CITATIONS, DEMO_PAPER_COUNT, DEMO_QUESTION, DEMO_REPOSITORY } from "@/components/marketing/demo-data";
import { CHAT_TRACE } from "@/components/marketing/how-it-works-content";
import Hotspot from "@/components/marketing/kit/Hotspot";
import { useMotionOK, useOnScreen } from "@/components/marketing/kit/motion";
import ThinkingOrb, { orbStateForStage } from "@/components/ui/ThinkingOrb";
import { CheckCircleIcon, CheckIcon, PauseIcon, PlayIcon, RefreshIcon, SendIcon } from "@/components/ui/Icons";

/*
 * One focused question followed end to end: what the reader sees on the left
 * (the question, the stage labels the real chat shows, then the answer), what
 * the reader does not see beneath it (a log of each step), and the steps
 * themselves on the right, lit as they run (facts: CHAT_TRACE).
 *
 * It plays once when it comes into view, can be paused, and stops on the
 * answer with a button to replay. Under reduced motion it is the answer.
 */

// The labels the chat shows while it works (src/lib/chat-progress.ts), and the trace steps each covers.
const STATUS = [
  { key: "planning", label: "Understanding your question", from: 1, to: 3 },
  { key: "retrieving", label: `Searching ${DEMO_PAPER_COUNT} papers`, from: 4, to: 4 },
  { key: "reading_evidence", label: "Reading the relevant passages", from: 5, to: 6 },
  { key: "synthesizing", label: "Writing the answer", from: 7, to: 7 },
  { key: "checking", label: "Checking it against the evidence", from: 8, to: 8 },
];

// Milliseconds on each trace step (1-9); step 10 is the answer, and stays.
const STEP_MS = [0, 900, 1000, 1300, 1400, 1400, 1100, 1600, 1700, 900];
const ANSWER = CHAT_TRACE.length + 1;
const TYPE_MS = 34;

export default function ChatRun() {
  const motionOK = useMotionOK();
  // Watches the chat window alone: the whole figure is taller than a phone screen.
  const [ref, onScreen] = useOnScreen<HTMLDivElement>({ once: true, amount: 0.5 });
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (onScreen && motionOK && !started) {
      setStarted(true);
      setPlaying(true);
    }
  }, [onScreen, motionOK, started]);

  useEffect(() => {
    if (!playing) return;
    if (step === 0) {
      const timer = window.setTimeout(
        () => (typed < DEMO_QUESTION.length ? setTyped(typed + 1) : setStep(1)),
        typed < DEMO_QUESTION.length ? TYPE_MS : 600
      );
      return () => window.clearTimeout(timer);
    }
    if (step >= ANSWER) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setStep(step + 1), STEP_MS[step]);
    return () => window.clearTimeout(timer);
  }, [playing, step, typed]);

  const shown = motionOK ? step : ANSWER;
  const finished = shown >= ANSWER;
  const replay = () => {
    setStep(0);
    setTyped(0);
    setPlaying(true);
  };
  const logs = CHAT_TRACE.slice(0, Math.min(shown, CHAT_TRACE.length));
  const fill = shown < 1 ? 0 : (Math.min(shown, CHAT_TRACE.length) - 1) / (CHAT_TRACE.length - 1);

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[12px] uppercase tracking-[0.04em] text-mute">One question, step by step · an illustrative run</p>
        {motionOK ? (
          <div className="flex gap-2">
            {!finished ? (
              <button
                type="button"
                onClick={() => setPlaying(!playing)}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-hairline bg-surface px-3.5 text-[13px] font-medium text-ink transition-colors hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
                {playing ? "Pause" : "Play"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={replay}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-hairline bg-surface px-3.5 text-[13px] font-medium text-ink transition-colors hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              Replay
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        {/* What the reader sees, and beneath it what they don't */}
        <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-7">
          <div ref={ref} className="overflow-hidden rounded-[14px] border border-hairline bg-surface shadow-float">
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 text-[13px]">
              <span className="truncate text-mute">
                Repositories <span aria-hidden="true">›</span> <span className="text-ink">{DEMO_REPOSITORY}</span>
              </span>
              <span className="flex-none font-mono text-[11px] text-mute">{DEMO_PAPER_COUNT} papers in scope</span>
            </div>
            <div className="flex min-h-[400px] flex-col gap-4 p-5">
              {shown >= 1 ? (
                <p className="enter-up ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-subtle px-4 py-2.5 text-[14px] leading-6 text-ink">
                  {DEMO_QUESTION}
                </p>
              ) : null}

              {shown >= 1 && !finished ? (
                <ul className="space-y-2">
                  {STATUS.filter((line) => shown >= line.from).map((line) => {
                    const done = shown > line.to;
                    return (
                      <li key={line.key} className={`enter-up flex items-center gap-2.5 text-[13px] ${done ? "text-mute" : "text-body"}`}>
                        {done ? <CheckIcon className="h-3.5 w-3.5" /> : <ThinkingOrb size={20} state={orbStateForStage(line.key)} />}
                        {line.label}
                        {done ? "" : "…"}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {finished ? (
                <div className="space-y-3.5">
                  <div className="space-y-2.5 text-[14.5px] leading-7 text-ink">
                    {DEMO_ANSWER.map((sentence, index) => (
                      <p key={sentence.cite} className="enter-up" style={{ animationDelay: `${index * 0.15}s` }}>
                        {sentence.text}
                        <Hotspot
                          variant="cite"
                          label={String(sentence.cite)}
                          title={`${DEMO_CITATIONS[sentence.cite - 1].title} (${DEMO_CITATIONS[sentence.cite - 1].year})`}
                          side="top"
                          align={index === 1 ? "center" : "end"}
                        >
                          <span className="mt-1 block border-l-2 border-[rgb(234_179_8/0.7)] pl-3 italic text-ink/80">
                            “{DEMO_CITATIONS[sentence.cite - 1].quote}”
                          </span>
                        </Hotspot>
                      </p>
                    ))}
                  </div>
                  <ul className="enter-up grid grid-cols-1 gap-2 sm:grid-cols-3" style={{ animationDelay: "0.4s" }}>
                    {DEMO_CITATIONS.map((citation) => (
                      <li key={citation.n} className="rounded-xl border border-hairline px-3 py-2.5 text-[12px] leading-[17px] text-ink">
                        <span className="font-mono text-accent-ink">{citation.n}</span> · {citation.title}
                        <span className="mt-1 block text-mute">{citation.year}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="enter-up flex items-center gap-2 text-[12.5px] text-mute" style={{ animationDelay: "0.6s" }}>
                    <CheckCircleIcon className="h-3.5 w-3.5 text-ink" />
                    Based on {DEMO_CITATIONS.length} of {DEMO_PAPER_COUNT} papers in {DEMO_REPOSITORY}.
                  </p>
                </div>
              ) : null}

              <div className="mt-auto flex items-center gap-2.5 rounded-full border border-hairline py-2 pl-4 pr-2 text-[14px]">
                <span className="min-w-0 flex-1 truncate">
                  {shown === 0 && typed > 0 ? (
                    <span className="text-ink">
                      {DEMO_QUESTION.slice(0, typed)}
                      <span aria-hidden="true" className="ml-px inline-block h-[1.05em] w-[1.5px] translate-y-[3px] bg-accent" />
                    </span>
                  ) : (
                    <span className="text-mute">Ask about your papers…</span>
                  )}
                </span>
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink text-canvas" aria-hidden="true">
                  <SendIcon className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[14px] border border-hairline bg-[#0a0a0a] text-[#e5e5e5]">
            <div className="flex justify-between gap-3 border-b border-[#262626] bg-[#0a0a0a] px-4 py-2.5 font-mono text-[11px] text-[#a3a3a3]">
              <span>backstage · what the reader doesn’t see</span>
              <span className="hidden sm:inline">chat service</span>
            </div>
            <ol className="flex min-h-[230px] flex-col gap-1.5 bg-[#0a0a0a] px-4 py-3.5 font-mono text-[12px] leading-[19px] text-[#e5e5e5]">
              {logs.map((entry, index) => (
                <li key={entry.title} className="enter-up flex gap-3 bg-[#0a0a0a] text-[#e5e5e5]">
                  <span className={`w-14 flex-none bg-[#0a0a0a] ${index === logs.length - 1 && !finished ? "bg-[#0a0a0a] text-[#93c5fd]" : "bg-[#0a0a0a] text-[#a3a3a3]"}`}>
                    {entry.log.tag}
                  </span>
                  <span className="min-w-0 break-words">{entry.log.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* The steps */}
        <ol className="relative flex flex-col gap-2 lg:col-span-5">
          <span aria-hidden="true" className="absolute bottom-6 left-[27px] top-6 w-px bg-hairline">
            <span className="absolute inset-x-0 top-0 bg-accent transition-[height] duration-500 ease-out-expo" style={{ height: `${fill * 100}%` }} />
          </span>
          {CHAT_TRACE.map((node, index) => {
            const number = index + 1;
            const state = shown > number ? "done" : shown === number ? "on" : finished ? "done" : "next";
            return (
              <li
                key={node.title}
                className={`relative flex gap-3.5 rounded-xl border bg-surface px-3.5 py-3 transition-[opacity,border-color,box-shadow] duration-400 ${
                  state === "on"
                    ? "border-accent opacity-100 shadow-[0_0_0_4px_rgb(var(--accent-soft))]"
                    : state === "done"
                      ? "border-hairline opacity-100"
                      : "border-hairline opacity-50"
                }`}
              >
                <span
                  className={`relative z-10 flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border font-mono text-[11px] ${
                    state === "on"
                      ? "border-accent bg-accent-soft text-accent-ink"
                      : state === "done"
                        ? "border-ink bg-ink text-canvas"
                        : "border-hairline-strong bg-surface text-mute"
                  }`}
                >
                  {number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[14px] font-medium text-ink">{node.title}</p>
                    {node.model ? <span className="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-body">{node.model}</span> : null}
                  </div>
                  {node.detail ? <p className="mt-1 text-[12.5px] leading-[18px] text-body">{node.detail}</p> : null}
                  {node.parallel ? (
                    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <p className="rounded-lg border border-hairline px-2.5 py-2 text-[12px] leading-[17px] text-body">
                        <span className="block font-medium text-ink">By words</span>
                        Exact terms in titles, abstracts, methods, results, topics and keywords
                      </p>
                      <p className="rounded-lg border border-hairline px-2.5 py-2 text-[12px] leading-[17px] text-body">
                        <span className="block font-medium text-ink">By meaning</span>
                        Embedded passages find the same idea in other words
                      </p>
                    </div>
                  ) : null}
                  {node.loop ? (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-body">
                      <RefreshIcon className="h-3 w-3" /> Not enough? It searches again for what is missing.
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="sr-only">
        An illustrative run on an invented collection of {DEMO_PAPER_COUNT} papers. The answer cites three papers; open a number to
        read the sentence it rests on.
      </p>
    </div>
  );
}

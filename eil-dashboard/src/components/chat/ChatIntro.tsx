"use client";

/**
 * What an empty chat page says.
 *
 * It said "Where should we begin?" and nothing else. A reader arriving for the
 * first time could not tell what the assistant knows, what it can be asked,
 * what it will refuse, or how many of their papers a question would search.
 *
 * Every example here is built from the reader's own paper titles, because a
 * generic example ("what are the main themes?") teaches nothing about what this
 * assistant can do with these papers, and a question naming a paper they
 * recognise also proves their repository was read.
 */
import React from "react";
import {
  CAPABILITIES,
  LIMITS,
  scopeDescription,
  type ExampleQuestion,
} from "@/lib/chat-guidance";
import { ANSWER_META_CLASS } from "@/lib/answer-typography";

export function ChatIntro({
  scopeLabel,
  eligiblePaperCount,
  examples,
  onAsk,
}: {
  scopeLabel: string;
  eligiblePaperCount: number | null;
  examples: ExampleQuestion[];
  onAsk: (question: string) => void;
}) {
  const [showLimits, setShowLimits] = React.useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-8 py-10">
      <div className="space-y-3 text-center">
        <h1 className="text-[2rem] font-semibold tracking-normal text-slate-900 dark:text-[#ececec] sm:text-[2.5rem]">
          Ask your papers
        </h1>
        <p className={`${ANSWER_META_CLASS} text-slate-600 dark:text-[#8e8e8e]`}>
          {scopeDescription(scopeLabel, eligiblePaperCount)}
        </p>
      </div>

      {examples.length > 0 ? (
        <div className="w-full space-y-2">
          {examples.map((example) => (
            <button
              key={example.text}
              type="button"
              onClick={() => onAsk(example.text)}
              className="block w-full break-words rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-[15px] leading-8 text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#0a0a0a] dark:text-[#ececec] dark:hover:border-[#2a2a2a] dark:hover:bg-[#121212] dark:hover:text-white"
            >
              {example.text}
            </button>
          ))}
        </div>
      ) : null}

      <div className="w-full space-y-3">
        <ul className="grid gap-2 sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
            <li
              key={capability.label}
              className={`rounded-xl border border-slate-200 px-3 py-2 ${ANSWER_META_CLASS} text-slate-600 dark:border-[#1f1f1f] dark:text-[#8e8e8e]`}
            >
              <span className="block font-semibold text-slate-800 dark:text-[#ececec]">
                {capability.label}
              </span>
              {capability.detail}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setShowLimits((previous) => !previous)}
          aria-expanded={showLimits}
          className={`${ANSWER_META_CLASS} text-slate-600 underline underline-offset-4 transition-colors hover:text-slate-800 dark:text-[#8e8e8e] dark:hover:text-[#ececec]`}
        >
          {showLimits ? "Hide what it cannot answer" : "What it cannot answer"}
        </button>

        {showLimits ? (
          <ul className="space-y-2">
            {LIMITS.map((limit) => (
              <li
                key={limit.label}
                className={`rounded-xl border border-slate-200 px-3 py-2 ${ANSWER_META_CLASS} text-slate-600 dark:border-[#1f1f1f] dark:text-[#8e8e8e]`}
              >
                <span className="block font-semibold text-slate-800 dark:text-[#ececec]">
                  {limit.label}
                </span>
                {limit.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Questions offered after an answer, built from what that answer did not cover.
 *
 * The answer already reports its own gaps, so these are the questions a reader
 * is about to type anyway.
 */
export function FollowUpSuggestions({
  suggestions,
  onAsk,
}: {
  suggestions: string[];
  onAsk: (question: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onAsk(suggestion)}
          className={`break-words rounded-full border border-slate-200 px-3 py-1.5 text-left ${ANSWER_META_CLASS} text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-[#1f1f1f] dark:text-[#b4b4b4] dark:hover:border-[#2a2a2a] dark:hover:bg-[#121212] dark:hover:text-white`}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

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
import Mascot from "@/components/ui/Mascot";

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
      <div className="flex flex-col items-center gap-3 text-center">
        <Mascot size={52} className="mb-2 text-ink" />
        <h1 className="text-[2rem] font-semibold tracking-normal text-ink sm:text-[2.5rem]">
          Ask your papers
        </h1>
        <p className={`${ANSWER_META_CLASS} text-body`}>
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
              className="block w-full break-words rounded-xl border border-hairline bg-surface px-4 py-3 text-left text-[15px] leading-8 text-ink transition-colors hover:border-hairline-strong hover:bg-subtle hover:text-ink"
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
              className={`rounded-xl border border-hairline px-3 py-2 ${ANSWER_META_CLASS} text-body dark:border-[#1f1f1f]`}
            >
              <span className="block font-semibold text-ink">
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
          className={`${ANSWER_META_CLASS} text-body underline underline-offset-4 transition-colors hover:text-ink`}
        >
          {showLimits ? "Hide what it cannot answer" : "What it cannot answer"}
        </button>

        {showLimits ? (
          <ul className="space-y-2">
            {LIMITS.map((limit) => (
              <li
                key={limit.label}
                className={`rounded-xl border border-hairline px-3 py-2 ${ANSWER_META_CLASS} text-body dark:border-[#1f1f1f]`}
              >
                <span className="block font-semibold text-ink">
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
          className={`break-words rounded-full border border-hairline px-3 py-1.5 text-left ${ANSWER_META_CLASS} text-body transition-colors hover:border-hairline-strong hover:bg-subtle hover:text-ink dark:border-[#1f1f1f]`}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

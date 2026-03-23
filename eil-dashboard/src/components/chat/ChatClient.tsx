"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  PaperIcon,
  SendIcon,
  SparkIcon,
} from "@/components/ui/Icons";

interface Citation {
  paperId: number;
  title: string;
  year: string;
  href: string;
  reason: string;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  mode?: "grounded" | "fallback";
  citations?: Citation[];
}

const STARTER_PROMPTS = [
  "Summarize the main research trends in this workspace.",
  "Find papers related to translanguaging and multilingual education.",
  "Compare the major track categories in this corpus.",
  "Which keywords appear most often across recent papers?",
];

function AssistantAvatar() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900">
      <SparkIcon className="h-4 w-4" />
    </span>
  );
}

function UserAvatar() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      U
    </span>
  );
}

export default function ChatClient() {
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      role: "assistant",
      mode: "grounded",
      content:
        "Ask about papers, topics, tracks, keywords, or trends in this workspace. I will answer from the stored corpus first and clearly label broader guidance when the data is not enough.",
    },
  ]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || loading) {
      return;
    }

    const nextMessages = [...messages, { role: "user" as const, content: prompt }];
    setMessages(nextMessages);
    setDraft("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: prompt,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      const payload = (await response.json()) as {
        answer?: string;
        mode?: "grounded" | "fallback";
        citations?: Citation[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Chat request failed.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.answer ?? "No answer returned.",
          mode: payload.mode,
          citations: payload.citations ?? [],
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          mode: "fallback",
          content:
            error instanceof Error
              ? error.message
              : "Something went wrong while generating the answer.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const showEmptyState = messages.length === 1;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8.5rem)] max-w-5xl flex-col">
      <div className="flex items-center justify-between gap-4 px-1 pb-4 pt-1 sm:px-2">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Workspace chat
          </p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
            Research assistant
          </h1>
        </div>
        <p className="hidden text-sm text-slate-500 dark:text-slate-400 md:block">
          Grounded on workspace data first
        </p>
      </div>

      <div className="flex-1 overflow-hidden rounded-[28px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="h-full overflow-y-auto">
          {showEmptyState && (
            <section className="mx-auto flex min-h-[48vh] max-w-3xl flex-col justify-center px-5 py-12 sm:px-8">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                How can I help with this research workspace?
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                Ask for trend summaries, paper comparisons, topic deep dives, or
                evidence-backed answers from the current corpus.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setDraft(prompt)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          )}

          {!showEmptyState && (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {messages.map((message, index) => (
                <section
                  key={`${message.role}-${index}`}
                  className={
                    message.role === "assistant"
                      ? "bg-white dark:bg-slate-950"
                      : "bg-slate-50/70 dark:bg-slate-900/60"
                  }
                >
                  <div className="mx-auto flex w-full max-w-4xl gap-3 px-4 py-6 sm:gap-4 sm:px-6">
                    <div className="mt-0.5 flex-none">
                      {message.role === "assistant" ? <AssistantAvatar /> : <UserAvatar />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                          {message.role === "assistant" ? "Assistant" : "You"}
                        </span>
                        {message.mode === "fallback" && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                            Broader guidance
                          </span>
                        )}
                      </div>

                      <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800 dark:text-slate-200">
                        {message.content}
                      </div>

                      {message.citations && message.citations.length > 0 && (
                        <div className="mt-5 space-y-2">
                          {message.citations.map((citation) => (
                            <Link
                              key={citation.paperId}
                              href={citation.href}
                              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-950"
                            >
                              <PaperIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400 dark:text-slate-500" />
                              <span className="min-w-0">
                                <span className="font-medium text-slate-900 dark:text-white">
                                  [Paper {citation.paperId}] {citation.title}
                                </span>
                                <span className="ml-2 text-slate-500 dark:text-slate-400">
                                  ({citation.year})
                                </span>
                                {citation.reason && (
                                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {citation.reason}
                                  </span>
                                )}
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          )}

          {loading && (
            <section className="bg-white dark:bg-slate-950">
              <div className="mx-auto flex w-full max-w-4xl gap-3 px-4 py-6 sm:gap-4 sm:px-6">
                <div className="mt-0.5 flex-none">
                  <AssistantAvatar />
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 dark:bg-slate-500" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms] dark:bg-slate-500" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms] dark:bg-slate-500" />
                  <span className="ml-2">Thinking...</span>
                </div>
              </div>
            </section>
          )}

          <div ref={scrollAnchorRef} />
        </div>
      </div>

      <div className="sticky bottom-0 mt-4 bg-transparent pb-2">
        <div className="mx-auto max-w-4xl">
          <form
            onSubmit={handleSubmit}
            className="overflow-hidden rounded-[28px] border border-slate-300 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-950 dark:shadow-none"
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message the workspace"
              className="min-h-[104px] w-full resize-none border-0 bg-transparent px-5 py-4 text-[15px] leading-7 text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white dark:placeholder:text-slate-500"
            />
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Session-only chat. Not yet saved in Supabase.
              </p>
              <button
                type="submit"
                disabled={loading || draft.trim().length === 0}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              >
                <SendIcon className="h-4 w-4" />
                <span>Send</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

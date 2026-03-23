"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ChatIcon,
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
  "What are the main topic trends in this workspace over time?",
  "Find papers related to translanguaging or multilingual education.",
  "How do the main track categories compare in the current dataset?",
];

function AssistantAvatar() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white">
      <SparkIcon className="h-4 w-4" />
    </span>
  );
}

function UserAvatar() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-700">
      <ChatIcon className="h-4 w-4" />
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
        "Ask about research papers, topics, keywords, tracks, or trends in the current workspace corpus. I will answer from the stored dataset first and clearly label any broader guidance when the corpus is not enough.",
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

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-6 py-4">
        <p className="text-sm font-medium text-slate-500">Workspace chat</p>
      </header>

      <div className="min-h-[72vh] bg-[#f7f7f8]">
        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
          {messages.length === 1 && (
            <section className="mx-auto max-w-3xl px-4 pb-8 pt-14 sm:px-6">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                Ask anything about the current research corpus
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
                This surface is intentionally plain. Ask a direct question, compare
                themes, or jump into a cited paper when you need evidence.
              </p>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setDraft(prompt)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="divide-y divide-slate-200/80">
            {messages.map((message, index) => (
              <section
                key={`${message.role}-${index}`}
                className={message.role === "assistant" ? "bg-white" : "bg-[#f7f7f8]"}
              >
                <div className="mx-auto flex max-w-3xl gap-4 px-4 py-6 sm:px-6">
                  <div className="mt-0.5 flex-none">
                    {message.role === "assistant" ? <AssistantAvatar /> : <UserAvatar />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {message.role === "assistant" ? "Assistant" : "You"}
                      </span>
                      {message.mode === "fallback" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          Broader guidance
                        </span>
                      )}
                    </div>

                    <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
                      {message.content}
                    </div>

                    {message.citations && message.citations.length > 0 && (
                      <div className="mt-5 space-y-2">
                        {message.citations.map((citation) => (
                          <Link
                            key={citation.paperId}
                            href={citation.href}
                            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition-colors hover:border-slate-300 hover:bg-white"
                          >
                            <PaperIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                            <span className="min-w-0">
                              <span className="font-medium text-slate-900">
                                [Paper {citation.paperId}] {citation.title}
                              </span>
                              <span className="ml-2 text-slate-500">({citation.year})</span>
                              {citation.reason && (
                                <span className="mt-1 block text-xs leading-5 text-slate-500">
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

            {loading && (
              <section className="bg-white">
                <div className="mx-auto flex max-w-3xl gap-4 px-4 py-6 sm:px-6">
                  <div className="mt-0.5 flex-none">
                    <AssistantAvatar />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
                    <span className="ml-2">Thinking...</span>
                  </div>
                </div>
              </section>
            )}

            <div ref={scrollAnchorRef} />
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <form
              onSubmit={handleSubmit}
              className="rounded-[28px] border border-slate-300 bg-white shadow-sm"
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Message the workspace..."
                className="min-h-24 w-full resize-none border-0 bg-transparent px-5 py-4 text-[15px] leading-7 text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-500">
                  Grounded on workspace data when possible.
                </p>
                <button
                  type="submit"
                  disabled={loading || draft.trim().length === 0}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <SendIcon className="h-4 w-4" />
                  <span>Send</span>
                </button>
              </div>
            </form>
            <p className="mt-3 text-center text-xs text-slate-400">
              This chat is session-only for now and is not yet saved in Supabase.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

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
    <div className="flex min-h-[70vh] flex-col">
      <header className="border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              Workspace Chat
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
              Ask about papers, trends, tracks, methods, or results. Answers use the
              stored corpus first and link back to the paper library when relevant.
            </p>
          </div>
          <div className="hidden rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 md:block">
            <p className="font-semibold uppercase tracking-[0.18em] text-gray-500">
              Mode
            </p>
            <p className="mt-1">Corpus-grounded first</p>
            <p>Lightweight fallback when needed</p>
          </div>
        </div>
      </header>

      <div className="flex-1 bg-[#f7f7f8]">
        <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 sm:px-6">
          <div className="flex-1 py-6 sm:py-8">
            <div className="space-y-6">
              {messages.map((message, index) => (
                <article
                  key={`${message.role}-${index}`}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`w-full max-w-3xl rounded-3xl border px-5 py-4 shadow-sm sm:px-6 ${
                      message.role === "user"
                        ? "border-gray-200 bg-white"
                        : "border-[#e7e7e9] bg-[#fcfcfd]"
                    }`}
                  >
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      <span>{message.role === "user" ? "You" : "Assistant"}</span>
                      {message.mode && (
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] tracking-[0.12em] ${
                            message.mode === "grounded"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {message.mode === "grounded"
                            ? "Grounded"
                            : "Broader guidance"}
                        </span>
                      )}
                    </div>

                    <div className="whitespace-pre-wrap text-[15px] leading-7 text-gray-800">
                      {message.content}
                    </div>

                    {message.citations && message.citations.length > 0 && (
                      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                          Paper references
                        </p>
                        <div className="mt-3 space-y-2">
                          {message.citations.map((citation) => (
                            <Link
                              key={citation.paperId}
                              href={citation.href}
                              className="block rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
                            >
                              <span className="font-semibold">
                                [Paper {citation.paperId}] {citation.title}
                              </span>
                              <span className="ml-2 text-gray-500">
                                ({citation.year})
                              </span>
                              {citation.reason && (
                                <span className="mt-1 block text-xs leading-5 text-gray-500">
                                  {citation.reason}
                                </span>
                              )}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="w-full max-w-3xl rounded-3xl border border-[#e7e7e9] bg-[#fcfcfd] px-5 py-4 shadow-sm sm:px-6">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Assistant
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
                      <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400 [animation-delay:120ms]" />
                      <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400 [animation-delay:240ms]" />
                      <span className="ml-2">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={scrollAnchorRef} />
            </div>
          </div>

          <aside className="mb-4 rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Prompt ideas
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    "What are the main topic trends in this workspace over time?",
                    "Find papers related to translanguaging or multilingual education.",
                    "How do the main track categories compare in the current dataset?",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setDraft(prompt)}
                      className="rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
              <p className="max-w-md text-sm leading-6 text-gray-500">
                This v1 chat is session-only in the browser. It does not save full
                chat history in Supabase yet.
              </p>
            </div>
          </aside>

          <div className="sticky bottom-0 pb-5 pt-2">
            <form
              onSubmit={handleSubmit}
              className="rounded-[28px] border border-gray-200 bg-white p-3 shadow-[0_12px_40px_rgba(15,23,42,0.08)]"
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Message the workspace corpus..."
                className="min-h-24 w-full resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-7 text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
              <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 pt-3">
                <p className="text-xs text-gray-500">
                  Press Enter to send. Shift+Enter adds a new line.
                </p>
                <button
                  type="submit"
                  disabled={loading || draft.trim().length === 0}
                  className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {loading ? "Thinking..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

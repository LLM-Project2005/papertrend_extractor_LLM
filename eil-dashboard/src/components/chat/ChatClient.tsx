"use client";

import { FormEvent, useState } from "react";

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
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      role: "assistant",
      mode: "grounded",
      content:
        "Ask about research papers, topics, keywords, tracks, or trends in the stored EIL corpus. If the corpus does not answer directly, I will label any broader guidance clearly.",
    },
  ]);

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

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Corpus Chat</h1>
          <p className="mt-1 text-sm text-gray-500">
            Corpus-grounded answers first, with clearly labeled broader guidance
            only when the dataset does not answer directly.
          </p>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-2">
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={`rounded-2xl border p-4 ${
                message.role === "user"
                  ? "ml-auto max-w-[85%] border-blue-200 bg-blue-50"
                  : "max-w-[92%] border-gray-200 bg-gray-50"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <span>{message.role === "user" ? "You" : "Assistant"}</span>
                {message.mode && (
                  <span
                    className={`rounded-full px-2 py-0.5 ${
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

              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                {message.content}
              </p>

              {message.citations && message.citations.length > 0 && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Paper references
                  </p>
                  <div className="space-y-2">
                    {message.citations.map((citation) => (
                      <a
                        key={citation.paperId}
                        href={citation.href}
                        className="block rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
                      >
                        <span className="font-semibold">
                          [Paper {citation.paperId}] {citation.title}
                        </span>
                        <span className="ml-2 text-gray-500">({citation.year})</span>
                        {citation.reason && (
                          <span className="mt-1 block text-xs text-gray-500">
                            {citation.reason}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about a paper, a topic trend, a track, or the corpus as a whole..."
            className="min-h-28 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Links in the answer open the Paper Explorer view for the cited paper.
            </p>
            <button
              type="submit"
              disabled={loading || draft.trim().length === 0}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading ? "Thinking..." : "Ask"}
            </button>
          </div>
        </form>
      </section>

      <aside className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Good prompts
          </h2>
          <div className="mt-3 space-y-2 text-sm text-gray-700">
            <button
              type="button"
              onClick={() =>
                setDraft("What are the main topic trends in the EIL corpus over time?")
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50"
            >
              What are the main topic trends in the EIL corpus over time?
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft("Find papers related to translanguaging or multilingual education.")
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50"
            >
              Find papers related to translanguaging or multilingual education.
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft("How does LAE compare with ELI in the current dataset?")
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50"
            >
              How does LAE compare with ELI in the current dataset?
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p className="font-semibold text-gray-800">Behavior</p>
          <p className="mt-2">
            This v1 chat does not persist threads in the database. It keeps the
            conversation only in the current browser session.
          </p>
        </div>
      </aside>
    </div>
  );
}

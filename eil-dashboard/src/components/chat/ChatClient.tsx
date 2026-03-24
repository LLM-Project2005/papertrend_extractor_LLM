"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AttachmentIcon,
  ChevronDownIcon,
  CopyIcon,
  FileIcon,
  ImageIcon,
  PaperIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
} from "@/components/ui/Icons";

interface Citation {
  paperId: number;
  title: string;
  year: string;
  href: string;
  reason: string;
}

interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  type: string;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  mode?: "grounded" | "fallback";
  citations?: Citation[];
  attachments?: AttachmentItem[];
}

const STARTER_PROMPTS = [
  "Summarize the main research trends in this workspace.",
  "Find papers related to translanguaging and multilingual education.",
  "Compare the major track categories in this corpus.",
  "Which keywords appear most often across recent papers?",
];

const MODEL_OPTIONS = [
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { value: "openai/gpt-4.1-mini", label: "GPT-4.1 mini" },
] as const;

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatClient({
  previewMode = false,
}: {
  previewMode?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [model, setModel] =
    useState<(typeof MODEL_OPTIONS)[number]["value"]>("openai/gpt-4o-mini");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [attachmentsMenuOpen, setAttachmentsMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!copiedMessageKey) {
      return;
    }

    const timer = window.setTimeout(() => setCopiedMessageKey(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedMessageKey]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAttachmentsMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function appendFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    }));

    setAttachments((current) => {
      const seen = new Set(current.map((item) => `${item.name}:${item.size}:${item.type}`));
      return [
        ...current,
        ...nextFiles.filter((file) => {
          const key = `${file.name}:${file.size}:${file.type}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        }),
      ];
    });
  }

  async function sendPrompt(
    prompt: string,
    promptAttachments: AttachmentItem[],
    baseMessages = messages
  ) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || loading) {
      return;
    }

    const nextMessages = [
      ...baseMessages,
      {
        role: "user" as const,
        content: trimmedPrompt,
        attachments: promptAttachments,
      },
    ];

    setMessages(nextMessages);
    setDraft("");
    setAttachments([]);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedPrompt,
          model,
          attachments: promptAttachments.map(({ name, size, type }) => ({
            name,
            size,
            type,
          })),
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendPrompt(draft, attachments);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function handleCopy(content: string, key: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageKey(key);
    } catch {
      setCopiedMessageKey(null);
    }
  }

  async function handleRegenerate(messageIndex: number) {
    if (loading) {
      return;
    }

    const previousMessages = messages.slice(0, messageIndex);
    const lastUserMessage = [...previousMessages]
      .reverse()
      .find((message) => message.role === "user");

    if (!lastUserMessage) {
      return;
    }

    setMessages(previousMessages);
    await sendPrompt(
      lastUserMessage.content,
      lastUserMessage.attachments ?? [],
      previousMessages
    );
  }

  const composerDisabled = loading || draft.trim().length === 0;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl flex-col">
      <div className="px-1 pb-4 pt-1 sm:px-2">
        <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">
          Workspace chat
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-950 dark:text-[#ececec]">
            Research assistant
          </h1>
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
            <span>
              {previewMode
                ? "Grounded on temporary preview data"
                : "Grounded on workspace data first"}
            </span>
          </div>
        </div>
        {previewMode ? (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Preview mode is active, so chat answers are temporarily based on the mock workspace dataset until the live backend analysis pipeline is restored.
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-1 sm:px-2">
          {messages.length === 0 ? (
            <section className="mx-auto flex min-h-[48vh] max-w-3xl flex-col justify-center px-2 py-10">
              <h2 className="text-center text-[2rem] font-semibold tracking-tight text-slate-950 dark:text-[#ececec]">
                How can I help with this research workspace?
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-7 text-slate-500 dark:text-[#8f8f8f]">
                Ask about papers, topics, tracks, keywords, or trends. Answers stay
                grounded in the current corpus first.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setDraft(prompt)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#303030] dark:bg-[#1f1f1f] dark:text-[#d1d1d1] dark:hover:border-[#3b3b3b] dark:hover:bg-[#232323]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-1 py-4 sm:px-2">
              {messages.map((message, index) => {
                const messageKey = `${message.role}-${index}`;
                const canRegenerate =
                  message.role === "assistant" &&
                  messages.slice(0, index).some((item) => item.role === "user");

                return (
                  <section key={messageKey}>
                    {message.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[82%] rounded-[26px] bg-slate-200 px-5 py-3 text-[15px] leading-7 text-slate-900 dark:bg-[#2f2f2f] dark:text-[#f5f5f5]">
                          <div className="whitespace-pre-wrap">{message.content}</div>

                          {message.attachments && message.attachments.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {message.attachments.map((attachment) => (
                                <span
                                  key={attachment.id}
                                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/70 px-3 py-1.5 text-xs text-slate-600 dark:border-[#424242] dark:bg-[#262626] dark:text-[#b9b9b9]"
                                >
                                  {attachment.type.startsWith("image/") ? (
                                    <ImageIcon className="h-3.5 w-3.5" />
                                  ) : (
                                    <FileIcon className="h-3.5 w-3.5" />
                                  )}
                                  <span>{attachment.name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {message.mode === "fallback" && (
                          <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-[#4a3722] dark:bg-[#2c2218] dark:text-[#e0b37b]">
                            Broader guidance
                          </div>
                        )}

                        <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800 dark:text-[#e5e5e5]">
                          {message.content}
                        </div>

                        {message.citations && message.citations.length > 0 && (
                          <div className="space-y-2">
                            {message.citations.map((citation) => (
                              <Link
                                key={citation.paperId}
                                href={citation.href}
                                className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#303030] dark:bg-[#202020] dark:hover:border-[#3b3b3b] dark:hover:bg-[#232323]"
                              >
                                <PaperIcon className="mt-0.5 h-4 w-4 flex-none text-slate-400 dark:text-[#8f8f8f]" />
                                <span className="min-w-0">
                                  <span className="font-medium text-slate-900 dark:text-[#ececec]">
                                    [Paper {citation.paperId}] {citation.title}
                                  </span>
                                  <span className="ml-2 text-slate-500 dark:text-[#8f8f8f]">
                                    ({citation.year})
                                  </span>
                                  {citation.reason ? (
                                    <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">
                                      {citation.reason}
                                    </span>
                                  ) : null}
                                </span>
                              </Link>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                          <button
                            type="button"
                            onClick={() => handleCopy(message.content, messageKey)}
                            className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#232323] dark:hover:text-[#ececec]"
                          >
                            <CopyIcon className="h-4 w-4" />
                            <span>
                              {copiedMessageKey === messageKey ? "Copied" : "Copy"}
                            </span>
                          </button>
                          {canRegenerate ? (
                            <button
                              type="button"
                              onClick={() => handleRegenerate(index)}
                              className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#232323] dark:hover:text-[#ececec]"
                            >
                              <RefreshIcon className="h-4 w-4" />
                              <span>Regenerate</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}

              {loading ? (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 dark:bg-[#8f8f8f]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms] dark:bg-[#8f8f8f]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms] dark:bg-[#8f8f8f]" />
                  </div>
                </section>
              ) : null}
            </div>
          )}

          <div ref={scrollAnchorRef} />
        </div>

        <div className="sticky bottom-0 mt-4 bg-transparent px-1 pb-2 sm:px-2">
          <div className="mx-auto max-w-4xl">
            <form
              onSubmit={handleSubmit}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  return;
                }
                setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                if (event.dataTransfer.files?.length) {
                  appendFiles(event.dataTransfer.files);
                }
              }}
              className={`overflow-hidden rounded-[28px] border bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-colors dark:bg-[#1f1f1f] dark:shadow-none ${
                dragActive
                  ? "border-slate-400 dark:border-[#5a5a5a]"
                  : "border-slate-300 dark:border-[#303030]"
              }`}
            >
              {attachments.length > 0 ? (
                <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 dark:border-[#2c2c2c]">
                  {attachments.map((attachment) => (
                    <span
                      key={attachment.id}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-[#3a3a3a] dark:bg-[#262626] dark:text-[#c3c3c3]"
                    >
                      {attachment.type.startsWith("image/") ? (
                        <ImageIcon className="h-3.5 w-3.5" />
                      ) : (
                        <AttachmentIcon className="h-3.5 w-3.5" />
                      )}
                      <span>{attachment.name}</span>
                      <span className="text-slate-400 dark:text-[#7f7f7f]">
                        {formatFileSize(attachment.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((item) => item.id !== attachment.id)
                          )
                        }
                        className="rounded-full px-1 text-slate-400 transition-colors hover:text-slate-700 dark:text-[#7f7f7f] dark:hover:text-[#ececec]"
                        aria-label={`Remove ${attachment.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Message Papertrend"
                className="min-h-[72px] max-h-40 w-full resize-none border-0 bg-transparent px-5 py-4 text-[15px] leading-7 text-slate-950 placeholder:text-slate-400 focus:outline-none dark:text-[#f5f5f5] dark:placeholder:text-[#6f6f6f]"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-3 dark:border-[#2c2c2c]">
                <div className="flex items-center gap-2">
                  <div className="relative" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setAttachmentsMenuOpen((current) => !current)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:bg-[#262626] dark:text-[#c8c8c8] dark:hover:border-[#444444] dark:hover:text-[#f2f2f2]"
                      aria-label="Add attachment"
                    >
                      <PlusIcon className="h-4 w-4" />
                    </button>

                    {attachmentsMenuOpen ? (
                      <div className="absolute bottom-12 left-0 z-20 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-[#353535] dark:bg-[#212121]">
                        <button
                          type="button"
                          onClick={() => {
                            setAttachmentsMenuOpen(false);
                            fileInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#282828]"
                        >
                          <FileIcon className="h-4 w-4" />
                          <span>Upload file</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAttachmentsMenuOpen(false);
                            fileInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#282828]"
                        >
                          <ImageIcon className="h-4 w-4" />
                          <span>Upload image</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        appendFiles(event.target.files);
                        event.target.value = "";
                      }
                    }}
                  />

                  <label className="relative">
                    <select
                      value={model}
                      onChange={(event) =>
                        setModel(event.target.value as (typeof MODEL_OPTIONS)[number]["value"])
                      }
                      className="appearance-none rounded-full border border-slate-200 bg-white px-4 py-2.5 pr-9 text-sm text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-slate-400 dark:border-[#353535] dark:bg-[#262626] dark:text-[#d0d0d0] dark:hover:border-[#444444] dark:focus:border-[#5a5a5a]"
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#7f7f7f]" />
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <p className="hidden text-xs text-slate-500 dark:text-[#8f8f8f] sm:block">
                    Drag files here to attach
                  </p>
                  <button
                    type="submit"
                    disabled={composerDisabled}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-[#ececec] dark:text-[#171717] dark:hover:bg-white dark:disabled:bg-[#3a3a3a] dark:disabled:text-[#7e7e7e]"
                    aria-label="Send message"
                  >
                    <SendIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

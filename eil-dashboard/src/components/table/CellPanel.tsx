"use client";

/*
 * A table cell's panel (docs/42, 2026-10-29, the user's request): what the
 * cell says and the sentence it came from, "Read again" for that one cell,
 * and a box to ask about it.
 *
 * Asking turns the card into a side chat docked on the right. The question is
 * a Chat conversation from the moment it is sent: about that one paper, named
 * after the cell, with the cell shown above the first question, so it is in
 * Chat's list at once and Open in Chat carries it on there. A cell asked about
 * before opens its conversation again.
 *
 * A Not confirmed cell shows what the reading answered and the sentence it
 * gave, with a warning, since the page shows it nowhere else.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AssistantAnswer } from "@/components/chat/AnswerBody";
import { readStoredEffort } from "@/components/chat/ThinkingEffort";
import { ArrowUpRightIcon, CloseIcon, RefreshIcon, SendIcon, SpinnerIcon, StopIcon, WarningIcon } from "@/components/ui/Icons";
import { hasOpenDialog } from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { buttonClass, iconButtonClass } from "@/components/ui/controls";
import PaperLink from "@/components/workspace/PaperLink";
import { chatEndpoint, newChatRequestId, readChatStream } from "@/lib/chat-http";
import { normalizeChatRequestPayload } from "@/lib/chat-request-payload";
import type { TableCell, TableColumn, TableRow } from "@/lib/paper-table";
import type { TableCellContext } from "@/lib/paper-table-chat";
import type { WorkspaceMessageRecord } from "@/types/research";

type Effort = "low" | "medium" | "high";

// Max is a long research run, not a question about one cell.
const EFFORTS: Array<{ value: Effort; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

interface ChatAnswer {
  error?: string;
  thread?: { id: string };
  messages?: WorkspaceMessageRecord[];
  answer?: string;
  citations?: WorkspaceMessageRecord["citations"];
  jobId?: string | null;
}

/** Stop names the answer, as Chat's does: closing the stream alone may not reach the server. */
function cancelAnswer(requestId: string | null, token: string | null): void {
  if (!requestId || !token) return;
  void fetch(chatEndpoint("/api/chat/cancel"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requestId }),
    keepalive: true,
  }).catch(() => undefined);
}

function spoken(messages: WorkspaceMessageRecord[]): WorkspaceMessageRecord[] {
  return messages.filter((message) => (message.role === "user" || message.role === "assistant") && message.message_kind === "chat");
}

export function cellContext(table: { id: string; name: string }, row: TableRow, column: TableColumn, cell: TableCell | undefined): TableCellContext {
  return {
    tableId: table.id,
    tableName: table.name.slice(0, 120),
    columnId: column.id,
    columnName: column.name.slice(0, 60),
    instruction: column.instruction.slice(0, 300),
    paperId: row.paperId,
    paperTitle: row.title.slice(0, 500),
    year: row.year.slice(0, 20),
    status: cell?.status ?? "failed",
    value: (cell?.value ?? "").slice(0, 240),
    quote: (cell?.quote ?? "").slice(0, 400),
    note: (cell?.note ?? "").slice(0, 120),
  };
}

export default function CellPanel({
  table,
  projectId,
  row,
  column,
  cell,
  threadId: linkedThread,
  token,
  reading,
  onReadAgain,
  onLinked,
  onDocked,
  onClose,
}: {
  table: { id: string; name: string };
  projectId: string;
  row: TableRow;
  column: TableColumn;
  cell: TableCell | undefined;
  /** The conversation asked from this cell before, if any. */
  threadId: string | null;
  token: string | null;
  /** The table is being read; the cell's own Read again waits. */
  reading: boolean;
  onReadAgain: () => void;
  onLinked: (threadId: string) => void;
  /** Whether the panel is a side chat, so the page can make room for it. */
  onDocked: (docked: boolean) => void;
  onClose: () => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(linkedThread);
  const [messages, setMessages] = useState<WorkspaceMessageRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(linkedThread));
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<Effort>(() => {
    const stored = readStoredEffort();
    return stored === "max" ? "high" : stored;
  });
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const docked = Boolean(threadId) || asking || messages.length > 0;
  useEffect(() => onDocked(docked), [docked, onDocked]);
  useEffect(() => () => onDocked(false), [onDocked]);

  // The conversation asked from this cell before; one deleted in Chat since leaves the panel as new.
  useEffect(() => {
    if (!linkedThread || !token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/chat/threads/${encodeURIComponent(linkedThread)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("The conversation could not be opened.");
        return (await response.json()) as { messages?: WorkspaceMessageRecord[] };
      })
      .then((detail) => {
        if (!cancelled) setMessages(spoken(detail.messages ?? []));
      })
      .catch(() => {
        if (cancelled) return;
        setThreadId(null);
        setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkedThread, token]);

  function stop() {
    controllerRef.current?.abort();
    cancelAnswer(requestIdRef.current, tokenRef.current);
    requestIdRef.current = null;
  }

  // Closing the panel stops an answer being written, as leaving Chat does; the question stays in the conversation.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      cancelAnswer(requestIdRef.current, tokenRef.current);
    },
    []
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !hasOpenDialog() && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, progress]);

  async function ask() {
    const question = draft.trim();
    if (!question || asking || !token) return;
    const first = !threadId;
    const context = cellContext(table, row, column, cell);
    const asked: WorkspaceMessageRecord = {
      id: `local-${Date.now()}`,
      thread_id: threadId ?? "",
      role: "user",
      message_kind: "chat",
      content: question,
      metadata: first ? { tableCell: context } : null,
    };
    const history = [...messages, asked];
    setDraft("");
    setError(null);
    setNotice(null);
    setMessages(history);
    setAsking(true);
    setProgress("Reading the paper…");
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = newChatRequestId();
    requestIdRef.current = requestId;
    try {
      const response = await fetch(chatEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "text/event-stream", "X-Chat-Request-Id": requestId },
        body: JSON.stringify(
          normalizeChatRequestPayload({
            message: question,
            messages: history.map((message) => ({ role: message.role, content: message.content })),
            projectId,
            knowledgeScope: { kind: "selected_papers", projectId, runIds: [row.runId] },
            selectedRunIds: [row.runId],
            toolMode: "auto",
            effort,
            chatMode: "normal",
            action: "message",
            ...(threadId ? { threadId } : { tableCell: context }),
          })
        ),
        signal: controller.signal,
      });
      const payload = await readChatStream<ChatAnswer>(response, (update) => {
        if (!controller.signal.aborted) setProgress(update.label);
      });
      const id = payload.thread?.id;
      if (id) {
        setThreadId(id);
        if (first) onLinked(id);
      }
      if (payload.messages?.length) setMessages(spoken(payload.messages));
      else {
        setMessages([
          ...history,
          { id: `local-${Date.now()}-answer`, thread_id: id ?? "", role: "assistant", message_kind: "chat", content: payload.answer ?? "No answer came back.", citations: payload.citations ?? [] },
        ]);
      }
      if (payload.jobId) setNotice("This answer is being written as a longer report. Open it in Chat to read it when it is ready.");
    } catch (reason) {
      if (controller.signal.aborted) setNotice("Stopped. The question stays in the conversation, to ask again here or in Chat.");
      else setError(reason instanceof Error ? reason.message : "The question could not be answered just now.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        requestIdRef.current = null;
      }
      setAsking(false);
      setProgress(null);
    }
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void ask();
  }

  const year = row.year && row.year !== "Unknown" ? ` · ${row.year}` : "";

  const head = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-mute">{column.name}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-body">
          {row.title}
          {year}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {threadId ? (
          asking ? (
            <span className={buttonClass("ghost", "sm", "pointer-events-none opacity-50")} title="Once the answer is in" aria-disabled="true">
              Open in Chat
            </span>
          ) : (
            <Link href={`/workspace/chat?thread=${encodeURIComponent(threadId)}`} className={buttonClass("ghost", "sm")}>
              Open in Chat
              <ArrowUpRightIcon className="h-3.5 w-3.5" />
            </Link>
          )
        ) : null}
        <button type="button" onClick={onClose} aria-label="Close" className={iconButtonClass("sm")}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const quoteClass = `mt-1.5 overflow-auto border-l-2 border-hairline-strong pl-3 text-[13px] leading-5 text-body ${docked ? "max-h-24" : "max-h-48"}`;
  const card = (
    <div className="rounded-lg bg-subtle px-3 py-2.5" data-cell-card="">
      {cell?.status === "found" ? (
        <>
          <p className="text-sm font-semibold leading-6 text-ink">
            {cell.value}
            {cell.note ? <span className="font-normal text-mute"> ({cell.note})</span> : null}
          </p>
          <blockquote className={quoteClass}>{cell.quote}</blockquote>
        </>
      ) : cell?.status === "unverified" ? (
        <>
          <p className="flex items-center gap-1.5 text-sm font-semibold leading-6 text-ink">
            <WarningIcon aria-hidden className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Not confirmed
          </p>
          <p className="mt-0.5 text-[13px] leading-5 text-body">
            The reading answered <span className="font-medium text-ink">&ldquo;{cell.value}&rdquo;</span>
            {cell.quote ? ", with this sentence, which is not in the paper as written:" : ", without a sentence from the paper."}
          </p>
          {cell.quote ? <blockquote className={quoteClass}>{cell.quote}</blockquote> : null}
        </>
      ) : cell?.status === "not_stated" ? (
        <p className="text-sm font-semibold leading-6 text-ink">
          Not stated
          <span className="font-normal text-mute">{cell.readWhole ? " · the whole paper was read" : " · read from parts of the paper"}</span>
        </p>
      ) : (
        <p className="text-sm leading-6 text-mute">Not read yet</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {cell?.status === "found" ? (
          // As a chat citation does: the paper opens on its PDF with this sentence marked.
          <PaperLink paper={{ paperId: row.paperId, tab: "preview", quote: cell.quote }} className={buttonClass("secondary", "sm")}>
            Show in paper
          </PaperLink>
        ) : (
          <PaperLink paper={{ paperId: row.paperId }} className={buttonClass("secondary", "sm")}>
            Open the paper
          </PaperLink>
        )}
        <button type="button" disabled={reading} onClick={onReadAgain} title="Read this cell again, from the whole paper" className={buttonClass("secondary", "sm")}>
          <RefreshIcon className="h-3.5 w-3.5" />
          Read again
        </button>
      </div>
    </div>
  );

  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void ask();
      }}
      className="rounded-xl border border-field bg-surface p-2 has-[textarea:focus]:border-accent has-[textarea:focus]:ring-4 has-[textarea:focus]:ring-accent/15"
    >
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onComposerKey}
        rows={docked ? 2 : 1}
        maxLength={4000}
        disabled={!token}
        aria-label={threadId ? "Ask a follow-up" : "Ask about this cell"}
        placeholder={threadId ? "Ask a follow-up…" : "Ask about this cell…"}
        className="block max-h-40 w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-6 text-ink outline-none placeholder:text-mute"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <Select value={effort} options={EFFORTS} onChange={setEffort} label="Thinking effort" prefix="Effort:" size="sm" placement="top" />
        {asking ? (
          <button type="button" onClick={stop} aria-label="Stop" className={buttonClass("secondary", "sm")}>
            <StopIcon className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim() || !token} aria-label="Ask" className={buttonClass("primary", "sm")}>
            <SendIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </form>
  );

  if (typeof document === "undefined") return null;
  // In a portal: inside the workspace's page, `fixed` placed a panel at the
  // foot of the page rather than of the screen, out of sight (pilot, 2026-10-28).
  return createPortal(
    <aside
      aria-label={`${column.name}: ${row.title}`}
      data-cell-panel={docked ? "docked" : "card"}
      className={
        docked
          ? "fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col border-t border-hairline bg-surface shadow-overlay sm:inset-x-auto sm:bottom-3 sm:right-3 sm:top-[4.75rem] sm:w-[420px] sm:rounded-xl sm:border"
          : "fixed inset-x-3 bottom-3 z-40 rounded-xl border border-hairline bg-surface p-4 shadow-overlay sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[440px]"
      }
    >
      {docked ? (
        <>
          <div className="border-b border-hairline px-4 py-3">
            {head}
            <div className="mt-2.5">{card}</div>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {loading ? (
              <p className="flex items-center gap-2 text-[13px] text-mute">
                <SpinnerIcon className="h-3.5 w-3.5" />
                Opening the conversation…
              </p>
            ) : null}
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-subtle px-3.5 py-2 text-sm leading-6 text-ink">{message.content}</p>
                </div>
              ) : (
                <div key={message.id} className="text-sm leading-7 text-body" data-cell-answer="">
                  <AssistantAnswer content={message.content} messageId={message.id} citations={message.citations} />
                </div>
              )
            )}
            {progress ? (
              <p className="flex items-center gap-2 text-[13px] text-mute">
                <SpinnerIcon className="h-3.5 w-3.5" />
                {progress}
              </p>
            ) : null}
            {notice ? <p className="text-[13px] leading-5 text-mute">{notice}</p> : null}
            {error ? (
              <p role="alert" className="text-[13px] leading-5 text-red-700 dark:text-red-300">
                {error}
              </p>
            ) : null}
            <div ref={endRef} />
          </div>
          <div className="border-t border-hairline p-3">{composer}</div>
        </>
      ) : (
        <>
          {head}
          <div className="mt-3">{card}</div>
          <div className="mt-3">{composer}</div>
        </>
      )}
    </aside>,
    document.body
  );
}

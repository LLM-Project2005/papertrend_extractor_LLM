import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stages a repository chat request passes through, in the order a reader sees
 * them. The labels are what the UI shows, so they describe the work rather than
 * the implementation.
 */
export const CHAT_PROGRESS_STAGES = [
  "planning",
  "loading_repository",
  "retrieving",
  "reading_evidence",
  "synthesizing",
  "checking",
  "formatting",
  "queued",
] as const;

export type ChatProgressStage = (typeof CHAT_PROGRESS_STAGES)[number];

export interface ChatProgressEvent {
  stage: ChatProgressStage;
  /** Short human-readable label, already localized by the caller when needed. */
  label: string;
  /** Optional extra context, such as how many papers are being read. */
  detail?: string;
  at: number;
}

const STAGE_LABELS: Record<ChatProgressStage, string> = {
  planning: "Understanding your question",
  loading_repository: "Opening your repository",
  retrieving: "Searching your papers",
  reading_evidence: "Reading the relevant passages",
  synthesizing: "Writing the answer",
  checking: "Checking it against the evidence",
  formatting: "Formatting citations",
  queued: "Handing off to a background job",
};

export function chatProgressLabel(stage: ChatProgressStage): string {
  return STAGE_LABELS[stage];
}

type ProgressSink = (event: ChatProgressEvent) => void;

const storage = new AsyncLocalStorage<ProgressSink>();

/**
 * Runs `fn` with a progress sink attached to the async context.
 *
 * AsyncLocalStorage is used so the pipeline can report progress without
 * threading a callback through every function between the route and the
 * retrieval and synthesis steps.
 */
export function runWithChatProgress<T>(sink: ProgressSink, fn: () => Promise<T>): Promise<T> {
  return storage.run(sink, fn);
}

/** Reports a stage. A no-op when nothing is listening, so callers need no guard. */
export function reportChatProgress(stage: ChatProgressStage, detail?: string): void {
  const sink = storage.getStore();
  if (!sink) return;
  try {
    sink({ stage, label: chatProgressLabel(stage), detail, at: Date.now() });
  } catch {
    // Progress reporting must never break the answer it is describing.
  }
}

/** True when a caller is listening for progress. */
export function chatProgressActive(): boolean {
  return storage.getStore() !== undefined;
}

/** Serialises an event as one Server-Sent Events frame. */
export function encodeProgressFrame(event: ChatProgressEvent): string {
  return `event: progress\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Serialises the final payload as one Server-Sent Events frame. */
export function encodeResultFrame(payload: unknown): string {
  return `event: result\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** Serialises a failure as one Server-Sent Events frame. */
export function encodeErrorFrame(message: string, status: number): string {
  return `event: error\ndata: ${JSON.stringify({ error: message, status })}\n\n`;
}

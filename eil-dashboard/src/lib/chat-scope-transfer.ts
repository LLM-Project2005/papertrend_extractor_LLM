/*
 * Handing papers to chat from another page: the semantic map by run, the
 * dashboard's drilldown by paper (docs/32, 4.3). The page writes a short-lived
 * note to localStorage and opens chat; chat reads it once, matches it against
 * the repository's own runs (the server's list, so nothing in the note grants
 * access), and starts the conversation scoped to those papers.
 */
import { paperIdForRun } from "@/lib/paper-id";
import { CHAT_SCOPE_TRANSFER_STORAGE_KEY } from "@/lib/workspace-session";

export const CHAT_SCOPE_TRANSFER_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_IDS = 500;

export interface ChatScopeTransfer {
  projectId: string;
  runIds: string[];
  paperIds: string[];
  prompt?: string;
  createdAt: string;
}

const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()))].slice(0, MAX_IDS)
    : [];

export function writeChatScopeTransfer(
  storage: Pick<Storage, "setItem">,
  input: { projectId: string; runIds?: string[]; paperIds?: string[]; prompt?: string },
  now = new Date()
): void {
  const transfer: ChatScopeTransfer = {
    projectId: input.projectId,
    runIds: ids(input.runIds),
    paperIds: ids(input.paperIds),
    prompt: input.prompt?.trim() || undefined,
    createdAt: now.toISOString(),
  };
  storage.setItem(CHAT_SCOPE_TRANSFER_STORAGE_KEY, JSON.stringify(transfer));
}

/** The note, if it is well formed, names some papers and is under 15 minutes old. */
export function readChatScopeTransfer(raw: string | null, now = Date.now()): ChatScopeTransfer | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChatScopeTransfer>;
    const runIds = ids(parsed.runIds);
    const paperIds = ids(parsed.paperIds);
    const age = now - new Date(parsed.createdAt ?? 0).getTime();
    if (typeof parsed.projectId !== "string" || !parsed.projectId) return null;
    if (runIds.length + paperIds.length === 0) return null;
    if (!Number.isFinite(age) || age < 0 || age > CHAT_SCOPE_TRANSFER_MAX_AGE_MS) return null;
    return {
      projectId: parsed.projectId,
      runIds,
      paperIds,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt.slice(0, 4000) : undefined,
      createdAt: String(parsed.createdAt),
    };
  } catch {
    return null;
  }
}

/** The repository's runs the note names, by run id or by the paper a run holds. */
export function runsInTransfer<T extends { id: string; copied_from_run_id?: string | null; input_payload?: Record<string, unknown> | null }>(
  runs: T[],
  transfer: Pick<ChatScopeTransfer, "runIds" | "paperIds">
): T[] {
  const runIds = new Set(transfer.runIds);
  const paperIds = new Set(transfer.paperIds);
  return runs.filter((run) => runIds.has(run.id) || (paperIds.size > 0 && paperIds.has(paperIdForRun(run))));
}

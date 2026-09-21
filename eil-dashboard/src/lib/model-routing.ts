/**
 * Which model answers which step of a chat turn.
 *
 * A focused answer makes five model calls in sequence, and until now every one
 * of them ran on the same reader-facing model. Measured on the pilot, three of
 * those five produce no prose at all - they emit a small JSON object that only
 * other code reads:
 *
 *   CHAT_EXECUTION_PLAN        ~3.2s   {refinedQuestion, retrievalQueries, ...}
 *   CHAT_RERANK                ~4.2s   {paperIds, reason, confidence}
 *   CHAT_EVIDENCE_SUFFICIENCY  ~3.2s   {sufficient, expansionQueries, ...}
 *
 * That is roughly half the model time of an answer spent on structured
 * bookkeeping. Those steps are classification and ordering, not writing, so
 * they run on the fast model while synthesis and the answer audit - the two
 * steps whose output a reader actually sees - keep the primary model.
 *
 * Every structural step already degrades safely: a malformed or missing result
 * falls back to deterministic reciprocal-rank fusion, to the plan repair pass,
 * or to skipping expansion. So the worst case of a fast model that returns
 * nothing usable is the pre-LLM behaviour, not a failed answer.
 */

/** Tasks whose output is parsed by code and never shown to a reader. */
const STRUCTURAL_TASKS: ReadonlySet<string> = new Set([
  "CHAT_EXECUTION_PLAN",
  "CHAT_EXECUTION_PLAN_REPAIR",
  "CHAT_RERANK",
  "CHAT_EVIDENCE_SUFFICIENCY",
]);

/** Already listed as tool-capable for this account, so no new dependency. */
export const DEFAULT_FAST_MODEL = "google/gemini-3.7-flash";

export function isStructuralTask(taskName: string | undefined): boolean {
  return Boolean(taskName && STRUCTURAL_TASKS.has(taskName));
}

/**
 * The configured fast model, or null when routing is switched off.
 *
 * `CHAT_FAST_MODEL=off` reverts every step to the primary model without a code
 * change, so a quality regression can be undone by editing one variable.
 */
export function fastModelSetting(raw: string | undefined = process.env.CHAT_FAST_MODEL): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return DEFAULT_FAST_MODEL;
  if (value.toLowerCase() === "off") return null;
  return value;
}

/**
 * The model a task should use, or undefined to leave the caller's default.
 *
 * Only OpenRouter deployments route, because the fast model is named in
 * OpenRouter's namespace and would be meaningless to another provider.
 */
export function modelForTask(input: {
  taskName?: string;
  requestedModel?: string;
  usesOpenRouter: boolean;
  fastModel?: string | null;
}): string | undefined {
  const requested = input.requestedModel?.trim() || undefined;
  if (!input.usesOpenRouter) return requested;
  if (!isStructuralTask(input.taskName)) return requested;
  const fast = input.fastModel === undefined ? fastModelSetting() : input.fastModel;
  return fast ?? requested;
}

/**
 * Which model answers which step of a chat turn.
 *
 * A focused answer makes five model calls in sequence, and until now every one
 * of them ran on the same reader-facing model. Measured on the pilot, three of
 * those five produce no prose at all - they emit a small JSON object that only
 * other code reads:
 *
 *   CHAT_EXECUTION_PLAN        ~3.2s   {refinedQuestion, retrievalQueries, ...}
 *   CHAT_EVIDENCE_SUFFICIENCY  ~3.2s   {sufficient, expansionQueries, ...}
 *
 * Those two steps route, classify and bookkeep; they do not write and they do
 * not decide what the answer is grounded in. They run on the fast model, while
 * every step that either writes for a reader or chooses the evidence keeps the
 * primary model.
 *
 * CHAT_RERANK is deliberately NOT on this list, although it looked like the
 * best candidate: it is the slowest of the three and also emits only JSON.
 * Measured on the 38-paper repository, the fast model returned the full source
 * limit of ten papers on 10 of 10 questions - it never once narrowed the field.
 * The primary model narrowed to a single paper on 5 of 12. A reranker that
 * returns everything is not ranking, and the papers it waves through become the
 * evidence the answer is built from, so the step belongs with synthesis rather
 * than with bookkeeping. The measurement is recorded in
 * docs/25-chat-page-improvement-plan.md.
 *
 * Both routed steps degrade safely: a malformed or missing result falls back to
 * the plan repair pass or to skipping expansion, so the worst case of a fast
 * model returning nothing usable is the previous behaviour, not a failed
 * answer.
 */

/** Tasks whose output is parsed by code and never shown to a reader. */
const STRUCTURAL_TASKS: ReadonlySet<string> = new Set([
  "CHAT_EXECUTION_PLAN",
  "CHAT_EXECUTION_PLAN_REPAIR",
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

/**
 * The models a reader can answer with, and what an answer on each usually uses
 * of the daily allowance. Pure, so the composer, the usage meter and the chat
 * route read one list.
 *
 * GPT-6.1 Sol was added beside GPT-6 Luna on 2026-10-22. Luna stays the
 * default. Sol counts against the allowance at its price over Luna's
 * (model-prices.ts), about twenty times, so a Sol answer is checked against
 * what is left before it starts.
 */
import { LUNA_MODEL, SOL_MODEL, usageMultiplier } from "@/lib/model-prices";

export interface ChatModel {
  value: string;
  label: string;
  vendor: string;
}

export const CHAT_MODELS: readonly ChatModel[] = [
  { value: LUNA_MODEL, label: "GPT-6 Luna", vendor: "OpenAI" },
  { value: SOL_MODEL, label: "GPT-6.1 Sol", vendor: "OpenAI" },
];

export const DEFAULT_CHAT_MODEL = LUNA_MODEL;

/** The model a request names when it is one a reader may choose; GPT-6 Luna otherwise. */
export function resolveChatModel(value?: string | null): string {
  const named = String(value ?? "").trim();
  return CHAT_MODELS.some((model) => model.value === named) ? named : DEFAULT_CHAT_MODEL;
}

export function chatModelLabel(value: string): string {
  return CHAT_MODELS.find((model) => model.value === value)?.label ?? "this model";
}

/** "By OpenAI.", and for a model dearer than GPT-6 Luna, how much more it counts. */
export function chatModelDescription(value: string): string {
  const model = CHAT_MODELS.find((item) => item.value === value);
  const multiplier = usageMultiplier(value);
  const vendor = model ? `By ${model.vendor}.` : "";
  return multiplier > 1 ? `${vendor} About ${multiplier}x usage.`.trim() : vendor;
}

/** What kind of request an allowance estimate is for. */
export type AllowanceKind = "low" | "medium" | "high" | "chart" | "max";

/**
 * What a typical request uses on GPT-6 Luna, in its tokens: the medians of the
 * question bank's runs on the test repository (2026-10-11), rounded up. A broad
 * question can use three times as much; the check is for the usual case, and an
 * answer that has started is never cut off.
 */
export const TYPICAL_LUNA_USAGE: Record<AllowanceKind, number> = {
  low: 15_000,
  medium: 35_000,
  high: 95_000,
  chart: 10_000,
  max: 200_000,
};

/**
 * At Max, another model only writes: GPT-6 Luna plans and reads the papers,
 * and the chosen model writes the answer from Luna's notes, about this many
 * tokens in and out (8,000 to 24,000 in the runs measured).
 */
export const TYPICAL_MAX_WRITING = 17_500;

/** What a request of this kind usually uses of the allowance, on this model. */
export function typicalUsage(model: string, kind: AllowanceKind): number {
  const multiplier = usageMultiplier(model);
  if (kind === "max") return TYPICAL_LUNA_USAGE.max + Math.round(TYPICAL_MAX_WRITING * (multiplier - 1));
  return Math.round(TYPICAL_LUNA_USAGE[kind] * multiplier);
}

/** About how many more requests of this kind fit in what is left today. */
export function requestsLeft(model: string, kind: AllowanceKind, left: number): number {
  return Math.max(0, Math.floor(left / typicalUsage(model, kind)));
}

const KIND_NAMES: Record<AllowanceKind, string> = {
  low: "an answer at Low",
  medium: "an answer at Medium",
  high: "an answer at High",
  chart: "a chart",
  max: "a Max answer",
};

function percentOf(part: number, whole: number): string {
  const value = whole > 0 ? (part / whole) * 100 : 0;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}%`;
}

/**
 * Why a request on a dearer model should not start, or null when it may. Only
 * models that count more than GPT-6 Luna are checked; Luna keeps the old rule,
 * that a request may start while anything is left.
 */
export function allowanceRefusal(input: {
  model: string;
  kind: AllowanceKind;
  used: number;
  limit: number;
  exempt: boolean;
}): string | null {
  const multiplier = usageMultiplier(input.model);
  if (input.exempt || multiplier <= 1) return null;
  const need = typicalUsage(input.model, input.kind);
  const left = Math.max(0, input.limit - input.used);
  if (need <= left) return null;
  const label = chatModelLabel(input.model);
  const what = input.kind === "max" ? `${KIND_NAMES.max} written by ${label}` : `${KIND_NAMES[input.kind]} with ${label}`;
  const counts = `${label} counts about ${multiplier} times GPT-6 Luna`;
  // A chart is counted the same at any effort, so a lower effort would not help it.
  const chart = input.kind === "chart";
  if (need > input.limit) {
    return `${what[0].toUpperCase()}${what.slice(1)} usually uses about ${percentOf(need, input.limit)} of a day's AI allowance (${counts}), so it can't fit in one day. ${chart ? "Ask with GPT-6 Luna." : "Choose a lower effort, or ask with GPT-6 Luna."}`;
  }
  return `${what[0].toUpperCase()}${what.slice(1)} usually uses about ${percentOf(need, input.limit)} of a day's AI allowance (${counts}), and ${percentOf(left, input.limit)} is left today. ${chart ? "Ask with GPT-6 Luna, or try again" : "Ask with GPT-6 Luna, choose a lower effort, or try again"} after the allowance resets at midnight UTC (7:00 in Thailand).`;
}

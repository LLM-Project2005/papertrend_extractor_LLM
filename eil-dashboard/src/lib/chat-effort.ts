/**
 * How hard an ordinary answer works (2026-10-10: thinking effort replaces the
 * Standard / Deep switch). Low reads the few papers that matter most and
 * reasons briefly; medium is the answer as it was; high reads more widely,
 * reasons at length and always has its claims checked. The top of the scale,
 * Max, is the research engine (src/lib/deep-research), not a setting here.
 * What each one changes is EFFORT_SETTINGS in repository-chat.ts.
 */
export type ChatEffort = "low" | "medium" | "high";

export const CHAT_EFFORTS = ["low", "medium", "high"] as const satisfies readonly ChatEffort[];

export function normalizeEffort(value: unknown): ChatEffort {
  return value === "low" || value === "high" ? value : "medium";
}

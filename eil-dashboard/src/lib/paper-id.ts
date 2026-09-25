export function paperIdFromRunId(runId: string | null | undefined): string {
  const normalized = String(runId ?? "").replace(/-/g, "").trim();
  if (!normalized) {
    return "";
  }

  const hex = normalized.slice(0, 15);
  if (!hex) {
    return "";
  }

  try {
    return BigInt(`0x${hex}`).toString(10);
  } catch {
    return "";
  }
}

export function normalizePaperId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return "";
}

/**
 * The paper a run produced.
 *
 * The worker derives it from the run id (the first 15 hex digits, a 60-bit
 * number). The copy kept in input_payload is that number as JSON, which
 * JSON.parse rounds - 1093441516503213193 arrives as 1093441516503213200 - so
 * it is only trusted when it can be exact: a string, or a safe integer. A copy
 * of a paper made in the Library points at the paper of the run it copied.
 */
export function paperIdForRun(run: {
  id: string;
  copied_from_run_id?: string | null;
  input_payload?: Record<string, unknown> | null;
}): string {
  const stored = run.input_payload?.paper_id;
  if (typeof stored === "string" && stored.trim()) return stored.trim();
  if (typeof stored === "number" && Number.isSafeInteger(stored)) return String(stored);
  if (typeof stored === "bigint") return stored.toString();
  return paperIdFromRunId(run.copied_from_run_id || run.id);
}

export function paperLookupKey(input: {
  folderId?: string | null;
  year?: string | null;
  title?: string | null;
}): string {
  return [
    String(input.folderId ?? "").trim(),
    String(input.year ?? "").trim(),
    String(input.title ?? "").trim().toLowerCase(),
  ].join("::");
}

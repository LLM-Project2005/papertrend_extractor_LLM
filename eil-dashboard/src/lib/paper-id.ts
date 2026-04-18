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

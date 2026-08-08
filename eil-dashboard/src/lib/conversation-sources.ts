export interface ConversationSource {
  paperId: number | string;
  title: string;
  year: string;
  href: string;
  reason: string;
  sourceType?: "paper" | "web";
}

export function dedupeConversationSources<T extends ConversationSource>(sources: T[]): T[] {
  const unique = new Map<string, T>();
  sources.forEach((source) => {
    const key = source.sourceType === "web"
      ? `web:${source.href.trim().toLowerCase() || source.title.trim().toLowerCase()}`
      : `paper:${String(source.paperId)}`;
    if (!unique.has(key)) unique.set(key, source);
  });
  return [...unique.values()].sort((left, right) =>
    left.sourceType === right.sourceType
      ? left.title.localeCompare(right.title)
      : left.sourceType === "web" ? 1 : -1
  );
}

export function previewConversationSources<T extends ConversationSource>(sources: T[], limit = 5) {
  const visible = sources.slice(0, Math.max(0, limit));
  return { visible, remaining: Math.max(0, sources.length - visible.length) };
}

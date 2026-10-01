import { citationPaperId, markCitations } from "@/lib/answer-citations";

export interface ConversationSource {
  paperId: number | string;
  title: string;
  year: string;
  href: string;
  reason: string;
  sourceType?: "paper" | "web";
}

/**
 * An answer's sources in the order its inline numbers give them, each with its
 * number (docs/32, 2.11, CHAT-7). The cards under an answer used to follow the
 * order retrieval returned, unnumbered, so "[2]" in the text matched no card.
 * Sources the text does not cite come last, unnumbered.
 */
export function numberAnswerSources<T extends { paperId?: unknown; title?: unknown; year?: unknown; href?: unknown }>(
  content: string,
  citations: T[]
): Array<T & { number?: number }> {
  const { sources } = markCitations(
    content,
    citations
      .filter((citation) => citation.paperId)
      .map((citation) => ({
        paperId: citationPaperId(citation),
        title: String(citation.title ?? ""),
        year: String(citation.year ?? ""),
        href: String(citation.href ?? ""),
      }))
  );
  const numberById = new Map(sources.map((source) => [source.paperId, source.number]));
  return citations
    .map((citation) => ({ ...citation, number: numberById.get(citationPaperId(citation)) }))
    .sort((left, right) => (left.number ?? Number.POSITIVE_INFINITY) - (right.number ?? Number.POSITIVE_INFINITY));
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

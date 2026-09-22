/**
 * Returns an identical question's answer without paying for it twice.
 *
 * Asking the same thing again is not unusual: a reader refines a question and
 * comes back to the first one, or shows the page to someone else, or reloads.
 * Each of those cost a full answer - five model calls and twenty-odd seconds -
 * to produce text that had already been produced.
 *
 * The key includes the repository's version hash, so the cache empties itself
 * the moment a paper is added, removed or re-analysed. That is the property
 * that makes this safe: a cached answer can never describe a corpus that has
 * since changed, because a changed corpus has a different key.
 */
import { createHash } from "node:crypto";

export interface CachedAnswer {
  answer: string;
  citations: unknown[];
  charts: unknown[];
  limitations: string[];
  storedAt: number;
}

export interface AnswerCacheKeyParts {
  ownerUserId: string;
  /** Identifies the corpus contents, so a changed repository misses the cache. */
  versionHash: string;
  scopeKey: string;
  question: string;
  answerLanguage?: string;
}

/** How long an entry stays usable. */
export const CACHE_TTL_MS = 30 * 60_000;

/** Entries held in one container, past which the oldest are dropped. */
export const MAX_ENTRIES = 200;

/**
 * Questions that differ only in spacing or case are the same question.
 *
 * Deliberately conservative: it does not stem, reorder or drop words, because
 * two questions that differ by one word usually want different answers, and
 * serving the wrong cached answer is far worse than missing the cache.
 */
export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cacheKey(parts: AnswerCacheKeyParts): string {
  return createHash("sha256")
    .update(
      [
        parts.ownerUserId,
        parts.versionHash,
        parts.scopeKey,
        parts.answerLanguage ?? "",
        normalizeQuestion(parts.question),
      ].join("\u0000")
    )
    .digest("hex");
}

const entries = new Map<string, CachedAnswer>();

function evictExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.storedAt > CACHE_TTL_MS) entries.delete(key);
  }
}

export function readAnswerCache(parts: AnswerCacheKeyParts, now: number = Date.now()): CachedAnswer | null {
  evictExpired(now);
  const entry = entries.get(cacheKey(parts));
  if (!entry) return null;
  if (now - entry.storedAt > CACHE_TTL_MS) return null;
  return entry;
}

export function writeAnswerCache(
  parts: AnswerCacheKeyParts,
  value: Omit<CachedAnswer, "storedAt">,
  now: number = Date.now()
): void {
  // An answer that failed, refused for a transport reason, or came back empty
  // is not worth keeping: it would serve the failure to everyone who asks the
  // same thing for the next half hour.
  if (!value.answer.trim()) return;
  evictExpired(now);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (oldest) entries.delete(oldest[0]);
  }
  entries.set(cacheKey(parts), { ...value, storedAt: now });
}

/** Test seam: how many answers are currently held. */
export function cachedAnswerCount(now: number = Date.now()): number {
  evictExpired(now);
  return entries.size;
}

/** Test seam: forget everything, so one test cannot see another's answers. */
export function resetAnswerCache(): void {
  entries.clear();
}

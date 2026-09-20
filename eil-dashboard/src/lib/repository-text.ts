export function normalizeRepositoryText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .toLocaleLowerCase("en-US");
}

// Thai is written without spaces, and Thai vowel/tone marks are Unicode category
// Mn rather than L. A plain /[\p{L}\p{N}]+/ pattern therefore splits Thai text at
// every mark and produces meaningless fragments, which silently corrupts word
// counts and lexical retrieval for Thai theses. Intl.Segmenter carries ICU's Thai
// dictionary and segments Thai correctly while producing byte-identical results
// to the previous pattern for Latin text.
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:'[\p{L}\p{N}\p{M}]+)*/gu;

let cachedSegmenter: Intl.Segmenter | null | undefined;

function wordSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    cachedSegmenter = new Intl.Segmenter("th", { granularity: "word" });
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** Splits a segment on characters the token contract treats as boundaries. */
function subTokens(segment: string): string[] {
  return segment.match(WORD_PATTERN) ?? [];
}

export function tokenizeRepositoryText(value: string): string[] {
  const normalized = normalizeRepositoryText(value);
  if (!normalized) return [];
  const segmenter = wordSegmenter();
  if (!segmenter) return subTokens(normalized);
  const tokens: string[] = [];
  for (const piece of segmenter.segment(normalized)) {
    if (!piece.isWordLike) continue;
    for (const token of subTokens(piece.segment)) tokens.push(token);
  }
  return tokens;
}

/** True when the text contains Thai script, which has no whitespace word breaks. */
export function containsThaiScript(value: string): boolean {
  return /[฀-๿]/.test(value);
}

export function buildRepositoryTermCounts(value: string): {
  totalWords: number;
  termCounts: Record<string, number>;
} {
  const tokens = tokenizeRepositoryText(value);
  const termCounts: Record<string, number> = {};
  tokens.forEach((token) => {
    if (token.length > 64) return;
    termCounts[token] = (termCounts[token] ?? 0) + 1;
  });
  return { totalWords: tokens.length, termCounts };
}

export function countTermInRepositoryText(content: string, term: string): number {
  const terms = tokenizeRepositoryText(term);
  if (terms.length === 0) return 0;
  const contentTokens = tokenizeRepositoryText(content);
  if (terms.length === 1) {
    return contentTokens.reduce((count, token) => count + (token === terms[0] ? 1 : 0), 0);
  }
  let count = 0;
  for (let index = 0; index <= contentTokens.length - terms.length; index += 1) {
    if (terms.every((token, offset) => contentTokens[index + offset] === token)) count += 1;
  }
  return count;
}

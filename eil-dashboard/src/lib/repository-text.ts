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

/**
 * Splits document text into retrieval passages, for Thai as well as English.
 *
 * The previous splitter relied on a blank line or an English sentence ending
 * followed by a capital letter. Thai has no capital letters and rarely uses
 * terminal punctuation, so a Thai document collapsed into one enormous passage
 * and retrieval could only ever quote its opening. Thai does separate clauses
 * with spaces, so long Thai runs are grouped into readable windows instead.
 */
export function splitTextPassages(
  text: string,
  options: { minLength?: number; targetLength?: number; maxPassages?: number } = {}
): string[] {
  const minLength = options.minLength ?? 80;
  const targetLength = options.targetLength ?? 700;
  const maxPassages = options.maxPassages ?? 240;
  const source = String(text ?? "").trim();
  if (!source) return [];

  const passages: string[] = [];
  const pushWindowed = (block: string) => {
    const clean = block.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (clean.length <= targetLength * 1.5) {
      passages.push(clean);
      return;
    }
    // Group space-delimited clauses up to the target size. This is the path
    // Thai text takes, and it also handles unpunctuated English fragments.
    let buffer = "";
    for (const clause of clean.split(" ")) {
      const candidate = buffer ? `${buffer} ${clause}` : clause;
      if (candidate.length > targetLength && buffer) {
        passages.push(buffer);
        buffer = clause;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) passages.push(buffer);
  };

  for (const paragraph of source.split(/\n{2,}/)) {
    const block = paragraph.trim();
    if (!block) continue;
    if (containsThaiScript(block)) {
      pushWindowed(block);
      continue;
    }
    const sentences = block.split(/(?<=[.!?])\s+(?=[\p{Lu}\d])/u);
    sentences.forEach(pushWindowed);
  }

  return [...new Set(passages.filter((passage) => passage.length >= minLength))].slice(0, maxPassages);
}

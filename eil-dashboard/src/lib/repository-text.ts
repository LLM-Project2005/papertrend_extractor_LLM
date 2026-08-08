export function normalizeRepositoryText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .toLocaleLowerCase("en-US");
}

export function tokenizeRepositoryText(value: string): string[] {
  return normalizeRepositoryText(value).match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
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

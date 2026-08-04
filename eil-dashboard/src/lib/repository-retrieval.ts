import {
  normalizeRepositoryText,
  tokenizeRepositoryText,
} from "@/lib/repository-text";

export interface RepositoryRetrievalDocument {
  paperId: string;
  title: string;
  abstract: string;
  methods: string;
  results: string;
  conclusion: string;
  content: string;
  topics: string[];
  keywords: string[];
}

export interface RepositoryRetrievalCandidate {
  paperId: string;
  title: string;
  excerpt: string;
  lexicalScore: number;
  metadataScore: number;
  phraseScore: number;
  fusedScore: number;
}

export interface CitationValidationResult {
  citedPaperIds: string[];
  invalidPaperIds: string[];
  hasSubstantiveText: boolean;
}

const RETRIEVAL_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "in", "is", "it", "of", "on", "or", "paper", "papers", "repository", "the",
  "this", "to", "was", "were", "what", "when", "where", "which", "with",
]);

function queryTokens(value: string): string[] {
  return [...new Set(
    tokenizeRepositoryText(value).filter(
      (token) => token.length > 2 && !RETRIEVAL_STOPWORDS.has(token)
    )
  )].slice(0, 32);
}

function splitEvidencePassages(document: RepositoryRetrievalDocument): string[] {
  const preferred = [
    document.abstract,
    document.methods,
    document.results,
    document.conclusion,
  ].filter(Boolean);
  const body = document.content
    .split(/\n{2,}|(?<=[.!?])\s+(?=[\p{Lu}\d])/u)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 80)
    .slice(0, 240);
  return [...new Set([...preferred, ...body])];
}

function passageLexicalScore(passage: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = normalizeRepositoryText(passage);
  const passageTokens = tokenizeRepositoryText(normalized);
  const counts = new Map<string, number>();
  passageTokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));
  const coverage = tokens.reduce((sum, token) => sum + (counts.has(token) ? 1 : 0), 0) / tokens.length;
  const frequency = tokens.reduce(
    (sum, token) => sum + Math.log1p(counts.get(token) ?? 0),
    0
  );
  return coverage * 8 + frequency;
}

function bestPassage(
  document: RepositoryRetrievalDocument,
  tokenGroups: string[][]
): { excerpt: string; score: number } {
  const fallback = document.abstract || document.content.slice(0, 1_200);
  let best = { excerpt: fallback, score: 0 };
  splitEvidencePassages(document).forEach((passage) => {
    const score = Math.max(0, ...tokenGroups.map((tokens) => passageLexicalScore(passage, tokens)));
    if (score > best.score) {
      best = { excerpt: passage.slice(0, 1_400), score };
    }
  });
  return best;
}

function metadataScore(
  document: RepositoryRetrievalDocument,
  tokenGroups: string[][]
): number {
  const title = normalizeRepositoryText(document.title);
  const labels = normalizeRepositoryText([...document.topics, ...document.keywords].join(" "));
  return Math.max(
    0,
    ...tokenGroups.map((tokens) =>
      tokens.reduce(
        (sum, token) =>
          sum + (title.includes(token) ? 4 : 0) + (labels.includes(token) ? 2.5 : 0),
        0
      )
    )
  );
}

function phraseScore(document: RepositoryRetrievalDocument, queries: string[]): number {
  const haystacks = [
    normalizeRepositoryText(document.title),
    normalizeRepositoryText([...document.topics, ...document.keywords].join(" ")),
    normalizeRepositoryText(document.abstract),
  ];
  return Math.max(
    0,
    ...queries.map((query) => {
      const normalized = normalizeRepositoryText(query).trim();
      if (normalized.length < 4) return 0;
      return Math.max(...haystacks.map((value, index) => value.includes(normalized) ? 6 - index : 0));
    })
  );
}

function rankChannel<T extends { paperId: string }>(
  values: T[],
  score: (value: T) => number
): Map<string, number> {
  return new Map(
    [...values]
      .filter((value) => score(value) > 0)
      .sort((left, right) => score(right) - score(left) || left.paperId.localeCompare(right.paperId))
      .map((value, index) => [value.paperId, index + 1])
  );
}

/**
 * Combines passage relevance, title/topic/keyword relevance, and exact-phrase
 * relevance with reciprocal-rank fusion. This remains deterministic and cheap;
 * the LLM only reranks the small candidate set returned here.
 */
export function rankRepositoryEvidence(
  documents: RepositoryRetrievalDocument[],
  queries: string[],
  limit = 16
): RepositoryRetrievalCandidate[] {
  const cleanedQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 8);
  const tokenGroups = cleanedQueries.map(queryTokens).filter((tokens) => tokens.length > 0);
  const candidates = documents.map((document) => {
    const passage = bestPassage(document, tokenGroups);
    return {
      paperId: document.paperId,
      title: document.title,
      excerpt: passage.excerpt,
      lexicalScore: passage.score,
      metadataScore: metadataScore(document, tokenGroups),
      phraseScore: phraseScore(document, cleanedQueries),
      fusedScore: 0,
    };
  });
  const lexicalRanks = rankChannel(candidates, (candidate) => candidate.lexicalScore);
  const metadataRanks = rankChannel(candidates, (candidate) => candidate.metadataScore);
  const phraseRanks = rankChannel(candidates, (candidate) => candidate.phraseScore);
  const fusionConstant = 60;
  candidates.forEach((candidate) => {
    const ranks = [lexicalRanks, metadataRanks, phraseRanks];
    candidate.fusedScore = ranks.reduce(
      (sum, ranking) => {
        const rank = ranking.get(candidate.paperId);
        return rank ? sum + 1 / (fusionConstant + rank) : sum;
      },
      0
    );
  });
  return candidates
    .sort(
      (left, right) =>
        right.fusedScore - left.fusedScore ||
        right.lexicalScore - left.lexicalScore ||
        left.title.localeCompare(right.title)
    )
    .slice(0, Math.max(1, Math.min(limit, 256)));
}

export function validateInlinePaperCitations(
  answer: string,
  allowedPaperIds: Iterable<string>
): CitationValidationResult {
  const allowed = new Set([...allowedPaperIds].map(String));
  const cited = [...answer.matchAll(/\[Paper\s+([^\]]+)\]/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  const citedPaperIds = [...new Set(cited.filter((paperId) => allowed.has(paperId)))];
  const invalidPaperIds = [...new Set(cited.filter((paperId) => !allowed.has(paperId)))];
  const withoutFormatting = answer
    .replace(/\[Paper\s+[^\]]+\]/gi, "")
    .replace(/[#*_`>|-]/g, "")
    .trim();
  return {
    citedPaperIds,
    invalidPaperIds,
    hasSubstantiveText: withoutFormatting.length >= 80,
  };
}

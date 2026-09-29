/*
 * Finds the passages that bear on a sub-question, across the full text of
 * every paper in scope.
 *
 * The old research worker read about three papers, and only keyword-picked
 * sentences from four summary fields; a question about a theme three papers
 * study could come back "no evidence". Here every paper's abstract, methods,
 * results, conclusion and body are split into passages and ranked with BM25
 * for each of the sub-question's queries, fused across queries, and chosen so
 * that one long paper cannot take every slot. Reference lists are left out:
 * a cited title matches a query without saying anything about it.
 *
 * Pure and in memory: the text is already loaded with the repository.
 */
import { normalizeRepositoryText, splitTextPassages, tokenizeRepositoryText } from "@/lib/repository-text";
import { LIMITS } from "@/lib/deep-research/types";

export interface PaperText {
  paperId: string;
  title: string;
  year: string;
  abstract: string;
  methods: string;
  results: string;
  conclusion: string;
  content: string;
  topics: string[];
  keywords: string[];
}

export interface Passage {
  paperId: string;
  title: string;
  year: string;
  section: string;
  text: string;
}

interface IndexedPassage extends Passage {
  terms: Map<string, number>;
  length: number;
  normalized: string;
}

export interface PassageIndex {
  passages: IndexedPassage[];
  /** Each paper's abstract passages: where a paper states what it found. */
  abstracts: Map<string, Passage[]>;
  documentFrequency: Map<string, number>;
  averageLength: number;
  /** Title, topics and keywords per paper, for a small paper-level boost. */
  profiles: Map<string, Set<string>>;
  papers: number;
}

const STOPWORDS = new Set([
  "a", "about", "across", "an", "and", "any", "are", "as", "at", "be", "been", "between", "both", "by", "can", "do",
  "does", "for", "from", "has", "have", "how", "in", "into", "is", "it", "its", "of", "on", "or", "paper", "papers",
  "study", "studies", "that", "the", "their", "these", "this", "those", "to", "used", "using", "was", "were", "what",
  "when", "where", "which", "who", "why", "with", "within", "research", "repository",
]);

/** A reference list, or a passage that is mostly one. */
export function looksLikeReferences(text: string): boolean {
  if (/^\s*(?:references|bibliography|works cited|บรรณานุกรม|เอกสารอ้างอิง)\b/i.test(text)) return true;
  // Entry shapes, not citations in passing: "Poehner, M. E. (2008). Title" and
  // "Poehner, 2008. Title". A literature review's "Poehner (2008) argued" or
  // "(Lantolf, 2000)." is the paper's own argument and stays.
  const apa = (text.match(/\((?:19|20)\d{2}[a-z]?\)\./g) ?? []).length;
  const harvard = (text.match(/[,.]\s(?:19|20)\d{2}[a-z]?\.\s+[A-Z]/g) ?? []).length;
  const dois = (text.match(/\bdoi(?:\.org)?[:/]/gi) ?? []).length;
  const pages = (text.match(/\bpp?\.\s?\d+/g) ?? []).length;
  const volumes = (text.match(/\b\d+\(\d+\),\s*\d+\s*[–-]\s*\d+/g) ?? []).length;
  return dois >= 2 || apa >= 3 || harvard >= 3 || apa + harvard + pages + volumes >= 4;
}

function termsOf(text: string): string[] {
  return tokenizeRepositoryText(text).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function counts(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
  return map;
}

/** Trims a passage to a length a reader can check, at a sentence end where one is near. */
export function trimPassage(text: string, max: number = LIMITS.passageChars): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.6 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max)}…`;
}

/** The same study uploaded twice has the same title and year. */
function studyKey(paper: Pick<PaperText, "title" | "year">): string {
  return `${normalizeRepositoryText(paper.title).replace(/[^\p{L}\p{N}]+/gu, " ").trim()}|${paper.year}`;
}

export function buildPassageIndex(papers: PaperText[]): PassageIndex {
  const passages: IndexedPassage[] = [];
  const profiles = new Map<string, Set<string>>();
  const abstracts = new Map<string, Passage[]>();
  const studies = new Set<string>();
  for (const paper of papers) {
    // A duplicate upload would be cited as a second source for the same study.
    const study = studyKey(paper);
    if (studies.has(study)) continue;
    studies.add(study);
    profiles.set(paper.paperId, new Set(termsOf([paper.title, ...paper.topics, ...paper.keywords].join(" "))));
    const seen = new Set<string>();
    const sections: Array<[string, string, number]> = [
      ["abstract", paper.abstract, 6],
      ["methods", paper.methods, 20],
      ["results", paper.results, 20],
      ["conclusion", paper.conclusion, 10],
      // Enough for a long thesis's closing chapters, where its results are.
      ["text", paper.content, 450],
    ];
    for (const [section, raw, maxPassages] of sections) {
      if (!raw?.trim()) continue;
      // A short abstract or conclusion still states the result; a short body fragment is usually a caption.
      const minimum = section === "abstract" || section === "conclusion" ? 60 : 120;
      for (const piece of splitTextPassages(raw, { targetLength: 900, maxPassages, minLength: minimum })) {
        const text = piece.replace(/\s+/g, " ").trim();
        const key = normalizeRepositoryText(text.slice(0, 180));
        if (text.length < minimum || seen.has(key) || looksLikeReferences(text)) continue;
        seen.add(key);
        if (section === "abstract") abstracts.set(paper.paperId, [...(abstracts.get(paper.paperId) ?? []), { paperId: paper.paperId, title: paper.title, year: paper.year, section, text }]);
        const tokens = termsOf(text);
        passages.push({
          paperId: paper.paperId,
          title: paper.title,
          year: paper.year,
          section,
          text,
          terms: counts(tokens),
          length: tokens.length,
          normalized: normalizeRepositoryText(text),
        });
      }
    }
  }
  const documentFrequency = new Map<string, number>();
  for (const passage of passages) for (const term of passage.terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const averageLength = passages.length ? passages.reduce((sum, passage) => sum + passage.length, 0) / passages.length : 1;
  return { passages, abstracts, documentFrequency, averageLength, profiles, papers: studies.size };
}

const K1 = 1.2;
const B = 0.75;

function bm25(index: PassageIndex, passage: IndexedPassage, terms: string[]): number {
  let score = 0;
  const total = index.passages.length;
  for (const term of terms) {
    const tf = passage.terms.get(term);
    if (!tf) continue;
    const df = index.documentFrequency.get(term) ?? 0;
    const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
    score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * passage.length) / index.averageLength)));
  }
  return score;
}

export interface PassageHit extends Passage {
  score: number;
}

/**
 * Adds the abstract of each paper the search found, when none of its hits is
 * from the abstract. The passages that match a question's words best are
 * often an introduction's; the abstract is where the paper states its
 * results, and without it a report could only say what a study set out to do.
 */
export function withAbstracts(index: PassageIndex, hits: PassageHit[], papers = 8): PassageHit[] {
  const out = [...hits];
  const order: string[] = [];
  for (const hit of hits) if (!order.includes(hit.paperId)) order.push(hit.paperId);
  for (const paperId of order.slice(0, papers)) {
    if (hits.some((hit) => hit.paperId === paperId && hit.section === "abstract")) continue;
    const abstract = index.abstracts.get(paperId)?.[0];
    if (abstract) out.push({ ...abstract, text: trimPassage(abstract.text), score: 0 });
  }
  return out;
}

/**
 * The passages that best answer any of the queries, fused across queries by
 * reciprocal rank, at most `perPaper` from one paper until every paper with a
 * match has had its turn.
 */
export function searchPassages(
  index: PassageIndex,
  queries: string[],
  options: { limit?: number; perPaper?: number } = {}
): PassageHit[] {
  const limit = options.limit ?? LIMITS.candidatesPerQuestion;
  const perPaper = options.perPaper ?? 2;
  const fused = new Map<IndexedPassage, number>();
  const raw = new Map<IndexedPassage, number>();
  for (const query of [...new Set(queries.map((value) => value.trim()).filter(Boolean))].slice(0, 8)) {
    const terms = [...new Set(termsOf(query))];
    if (terms.length === 0) continue;
    const phrase = normalizeRepositoryText(query).trim();
    const scored: Array<[IndexedPassage, number]> = [];
    for (const passage of index.passages) {
      let score = bm25(index, passage, terms);
      if (score <= 0) continue;
      // The whole phrase, as written, is stronger evidence than its words apart.
      if (terms.length >= 2 && phrase.length >= 6 && passage.normalized.includes(phrase)) score *= 1.5;
      // A paper whose title or keywords name the subject is more likely to be about it.
      const profile = index.profiles.get(passage.paperId);
      if (profile) score *= 1 + 0.15 * terms.filter((term) => profile.has(term)).length / terms.length;
      scored.push([passage, score]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    scored.slice(0, 60).forEach(([passage, score], rank) => {
      fused.set(passage, (fused.get(passage) ?? 0) + 1 / (60 + rank + 1));
      raw.set(passage, Math.max(raw.get(passage) ?? 0, score));
    });
  }
  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1] || (raw.get(b[0]) ?? 0) - (raw.get(a[0]) ?? 0));
  const chosen: IndexedPassage[] = [];
  const perPaperCount = new Map<string, number>();
  // First pass: spread across papers; second: fill with the next best.
  for (const cap of [perPaper, Number.POSITIVE_INFINITY]) {
    for (const [passage] of ranked) {
      if (chosen.length >= limit) break;
      if (chosen.includes(passage)) continue;
      const used = perPaperCount.get(passage.paperId) ?? 0;
      if (used >= cap) continue;
      chosen.push(passage);
      perPaperCount.set(passage.paperId, used + 1);
    }
  }
  return chosen.map((passage) => ({
    paperId: passage.paperId,
    title: passage.title,
    year: passage.year,
    section: passage.section,
    text: trimPassage(passage.text),
    score: Math.round((fused.get(passage) ?? 0) * 100_000) / 100_000,
  }));
}

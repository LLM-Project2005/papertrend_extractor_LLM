/**
 * The passage behind each citation in an answer.
 *
 * A numbered citation used to name the paper and nothing more, so a reader who
 * wanted to check a claim had to open the paper and hunt for it. Each paper
 * citation now carries the passage that supports the sentence citing it: one
 * to three of the paper's sentences, quoted as the text the answer read has
 * them, which the paper window can then find and mark in the PDF.
 *
 * It is worked out after the answer is written, without another model call.
 * For each sentence that cites a paper, every window of one to three of that
 * paper's sentences is scored by the words it shares with the sentence,
 * weighted as BM25 weights them, so a word every passage of the paper uses
 * counts for little. A sentence that shares too little with every window gets
 * no quote: a passage that does not support the claim is worse than none.
 *
 * Pure, so it is tested directly.
 */
import {
  citationPaperId,
  markCitations,
  type CitationPassage,
  type CitationPassageFields,
  type MarkerPassage,
} from "@/lib/answer-citations";
import { containsThaiScript, tokenizeRepositoryText } from "@/lib/repository-text";

/** The longest quote a citation carries: a reader checks it in a hover card. */
export const QUOTE_MAX_CHARS = 400;
/** Shorter than this, a window is a heading or a caption rather than a statement. */
const QUOTE_MIN_CHARS = 40;
const QUOTE_SENTENCES = 3;
/** Thai has no sentence punctuation; its clauses are grouped to about this length. */
const THAI_UNIT_CHARS = 180;
/** How much of an answer, back from a marker, is read as the claim it closes. */
const CLAIM_MAX_CHARS = 600;
/** paper-reading.ts marks text it left out with this, on a line of its own. */
const GAP = "[…]";

/** Each paper's text as an answer read it, and what else speaks for a paper. */
export interface PassageSources {
  /** By paper id, in paper-reading.ts's layout: "### Section" headings, "[…]" where text was left out. */
  readings: Map<string, string>;
  /** Text about a paper that cites it without a marker: its section of a paper-by-paper answer. */
  claims?: Map<string, string[]>;
}

const STOPWORDS = new Set([
  "a", "about", "across", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been", "between", "both",
  "but", "by", "can", "could", "did", "do", "does", "each", "for", "from", "had", "has", "have", "how", "however", "in",
  "into", "is", "it", "its", "may", "might", "more", "most", "not", "of", "on", "one", "or", "other", "paper", "papers",
  "such", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "those", "through", "to",
  "was", "were", "what", "when", "where", "which", "while", "who", "why", "will", "with", "within", "would",
  "study", "studies", "research", "author", "authors", "report", "reports", "reported", "found", "find", "finds",
  "show", "shows", "showed", "shown", "suggest", "suggests", "suggested", "note", "notes", "noted",
  "การ", "และ", "ของ", "ใน", "ที่", "เป็น", "ได้", "มี", "ให้", "จาก", "ว่า", "ซึ่ง", "โดย", "กับ", "นี้", "ไม่", "แต่", "หรือ",
  "เพื่อ", "ความ", "จะ", "ไป", "มา", "อยู่", "แล้ว", "ก็", "ด้วย", "นั้น", "งานวิจัย", "การศึกษา", "ผู้วิจัย", "พบว่า",
]);

function termsOf(text: string): string[] {
  return tokenizeRepositoryText(text).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * A reading cut into stretches of continuous text, each with its section.
 * A window never spans a "[…]": the text either side of it is not adjacent
 * in the paper, so a quote across it would be words the paper never printed
 * together.
 */
export function readingSegments(text: string): Array<{ section?: string; text: string }> {
  const segments: Array<{ section?: string; text: string }> = [];
  let section: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) segments.push({ ...(section ? { section } : {}), text: body });
    lines = [];
  };
  for (const line of String(text ?? "").split("\n")) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      // "Text" is paper-reading.ts's name for a paper whose headings were not found.
      const label = heading[1].trim().slice(0, 80);
      section = label && label !== "Text" ? label : undefined;
      continue;
    }
    if (line.trim() === GAP) {
      flush();
      continue;
    }
    lines.push(line);
  }
  flush();
  return segments;
}

/** A run with no break opportunity is cut where a reader could still follow it. */
function boundedPieces(piece: string): string[] {
  if (piece.length <= QUOTE_MAX_CHARS) return [piece];
  const target = Math.floor(QUOTE_MAX_CHARS * 0.75);
  const out: string[] = [];
  let rest = piece;
  while (rest.length > QUOTE_MAX_CHARS) {
    let cut = rest.lastIndexOf(" ", target);
    if (cut < target / 2) {
      // No space to cut at (a long Thai run): cut by length, but never between
      // a letter and the vowel or tone mark written over it.
      cut = target;
      while (cut < rest.length && /\p{M}/u.test(rest[cut])) cut += 1;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** Thai separates clauses with spaces; they are grouped into sentence-sized units. */
function thaiUnits(block: string): string[] {
  const units: string[] = [];
  let current = "";
  for (const clause of block.split(" ")) {
    const next = current ? `${current} ${clause}` : clause;
    if (current && next.length > THAI_UNIT_CHARS) {
      units.push(current);
      current = clause;
    } else {
      current = next;
    }
  }
  if (current) units.push(current);
  return units;
}

/** A stretch of text as sentences (Thai: clause groups), in order. */
function sentenceUnits(text: string): string[] {
  const units: string[] = [];
  // A line-end hyphen joins the word it split, as the PDF matcher reads it.
  const joined = text.replace(/(\p{Ll})-[ \t]*\n[ \t]*(\p{Ll})/gu, "$1$2");
  for (const paragraph of joined.split(/\n{2,}/)) {
    const block = paragraph.replace(/\s+/g, " ").trim();
    if (!block) continue;
    const pieces = containsThaiScript(block) ? thaiUnits(block) : block.split(/(?<=[.!?])\s+(?=[\p{Lu}\d(“"])/u);
    for (const piece of pieces) units.push(...boundedPieces(piece.trim()));
  }
  return units.filter(Boolean);
}

interface Window {
  section?: string;
  text: string;
  terms: Map<string, number>;
  /** Words, without stopwords: BM25's document length. */
  length: number;
  order: number;
}

interface PaperWindows {
  windows: Window[];
  documentFrequency: Map<string, number>;
  averageLength: number;
  /** The paper's title words: a claim names the paper with them, which is not evidence. */
  titleTerms: Set<string>;
}

/** Every window of one to three consecutive sentences, within the quote's length. */
export function passageWindows(reading: string, title = ""): PaperWindows {
  const windows: Window[] = [];
  let order = 0;
  for (const segment of readingSegments(reading)) {
    const units = sentenceUnits(segment.text).map((text) => ({ text, terms: termsOf(text) }));
    for (let start = 0; start < units.length; start += 1) {
      let text = "";
      const terms = new Map<string, number>();
      let length = 0;
      for (let end = start; end < Math.min(units.length, start + QUOTE_SENTENCES); end += 1) {
        const next = text ? `${text} ${units[end].text}` : units[end].text;
        if (next.length > QUOTE_MAX_CHARS) break;
        text = next;
        for (const term of units[end].terms) terms.set(term, (terms.get(term) ?? 0) + 1);
        length += units[end].terms.length;
        if (text.length >= QUOTE_MIN_CHARS) {
          windows.push({ ...(segment.section ? { section: segment.section } : {}), text, terms: new Map(terms), length, order: order++ });
        }
      }
    }
  }
  const documentFrequency = new Map<string, number>();
  for (const window of windows) for (const term of window.terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const averageLength = windows.length ? windows.reduce((sum, window) => sum + window.length, 0) / windows.length : 1;
  return { windows, documentFrequency, averageLength: averageLength || 1, titleTerms: new Set(termsOf(title)) };
}

/**
 * The window of the paper that best supports `claim`, or null when none
 * shares enough of its words. A claim's words that are only the paper's title
 * count for a third: "Smith's study of feedback" names the paper, and the
 * title page would otherwise win every time.
 */
export function bestPassage(claim: string, paper: PaperWindows): CitationPassage | null {
  const claimTerms = [...new Set(termsOf(claim))].map((term) => ({ term, weight: paper.titleTerms.has(term) ? 0.35 : 1 }));
  const substantive = claimTerms.filter((entry) => entry.weight === 1).length;
  if (substantive === 0 || paper.windows.length === 0) return null;
  const needed = Math.min(2, substantive);
  const total = paper.windows.length;
  let best: { window: Window; score: number } | null = null;
  for (const window of paper.windows) {
    let score = 0;
    let matched = 0;
    for (const { term, weight } of claimTerms) {
      const tf = window.terms.get(term);
      if (!tf) continue;
      if (weight === 1) matched += 1;
      const df = paper.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      score += weight * idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * window.length) / paper.averageLength)));
    }
    if (matched < needed || score <= 0) continue;
    if (
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 &&
        (window.text.length < best.window.text.length ||
          (window.text.length === best.window.text.length && window.order < best.window.order)))
    ) {
      best = { window, score };
    }
  }
  if (!best) return null;
  return { quote: best.window.text, ...(best.window.section ? { section: best.window.section } : {}) };
}

export interface CitedClaim {
  /** The marker's place among the answer's markers, from 0 (MarkerPassage.at). */
  at: number;
  /** The words the marker closes. */
  claim: string;
  paperIds: string[];
}

const MARKER = /\[\[cite:([\d,]+)\]\]/g;

function withoutMarkers(text: string): string {
  return text.replace(MARKER, " ").replace(/\s+/g, " ").trim();
}

/** Where the sentence holding `index` starts: after a full stop, a line break or the start. */
function sentenceStart(text: string, index: number): number {
  let start = 0;
  for (const match of text.slice(0, index).matchAll(/[.!?](?:\s|$)|\n/g)) start = (match.index ?? 0) + match[0].length;
  return start;
}

/** Where the sentence holding `index` ends. */
function sentenceEnd(text: string, index: number): number {
  const rest = text.slice(index);
  const match = /[.!?](?:\s|$)|\n/.exec(rest);
  return match ? index + match.index + 1 : text.length;
}

/**
 * Each citation marker in an answer, with the claim it closes and the papers
 * it cites. The answer is marked exactly as the renderer marks it
 * (markCitations), so the n-th marker here is the n-th marker on screen.
 *
 * The claim is the words since the sentence began, or since the marker before
 * it in the same sentence: "A raised scores [1], while B lowered them [2]"
 * gives each paper its own half. When that is only a word or two ("According
 * to [1], ..."), the whole sentence is the claim.
 */
export function citedClaims(
  answer: string,
  citations: Array<{ paperId: string; title: string; year: string; href: string }>
): CitedClaim[] {
  const { text, sources } = markCitations(answer, citations);
  const paperByNumber = new Map(sources.map((source) => [source.number, source.paperId]));
  const claims: CitedClaim[] = [];
  let previousEnd = 0;
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    const start = sentenceStart(text, index);
    let claim = withoutMarkers(text.slice(Math.max(start, previousEnd), index));
    if (termsOf(claim).length < 3) {
      // The answer writer puts its citations after the full stop: "... for all
      // learners. (Title, 2024)". Such a marker closes the sentences before it
      // on its line, back to the marker before; only one inside an unfinished
      // sentence ("According to [1], ...") stands for its whole sentence. Every
      // live answer's claims were empty, so no citation had a quote (the pilot, 2026-10-11).
      const trailing = !withoutMarkers(text.slice(start, index)).trim();
      const before = text.slice(previousEnd, index);
      const line = withoutMarkers(before.slice(before.lastIndexOf("\n") + 1));
      claim = trailing && termsOf(line).length >= 3 ? line : withoutMarkers(text.slice(start, sentenceEnd(text, end)));
    }
    const paperIds = [
      ...new Set(
        match[1]
          .split(",")
          .map((number) => paperByNumber.get(Number(number)))
          .filter((paperId): paperId is string => Boolean(paperId))
      ),
    ];
    claims.push({ at, claim: claim.slice(-CLAIM_MAX_CHARS), paperIds });
    previousEnd = end;
    at += 1;
  }
  return claims;
}

/**
 * The citations with the passage behind each: `quote` and `section` for the
 * first claim that cites the paper, `passages` for each marker. A paper no
 * marker cites can still be quoted for the text about it (`sources.claims`),
 * as a paper-by-paper answer gives each paper a section instead of markers.
 * Web pages and papers whose text was not read are left as they are.
 */
export function attachCitationPassages<
  T extends { paperId: unknown; title: string; year: string; href: string; sourceType?: string }
>(answer: string, citations: T[], sources: PassageSources): Array<T & CitationPassageFields> {
  if (citations.length === 0 || sources.readings.size === 0) return citations;
  const papers = new Map<string, PaperWindows | null>();
  const titles = new Map(citations.map((citation) => [citationPaperId(citation), citation.title]));
  const windowsFor = (paperId: string): PaperWindows | null => {
    if (!papers.has(paperId)) {
      const reading = sources.readings.get(paperId);
      papers.set(paperId, reading?.trim() ? passageWindows(reading, titles.get(paperId) ?? "") : null);
    }
    return papers.get(paperId) ?? null;
  };

  const byPaper = new Map<string, MarkerPassage[]>();
  // A paper's own quote comes from a claim about it alone where there is one:
  // an answer's opening cites every paper at once, and its passage for each
  // paper was the weakest (the pilot, 2026-10-11).
  const alone = new Map<string, MarkerPassage>();
  const claims = citedClaims(
    answer,
    citations.map((citation) => ({ paperId: citationPaperId(citation), title: citation.title, year: citation.year, href: citation.href }))
  );
  for (const claim of claims) {
    for (const paperId of claim.paperIds) {
      const paper = windowsFor(paperId);
      const found = paper ? bestPassage(claim.claim, paper) : null;
      if (!found) continue;
      byPaper.set(paperId, [...(byPaper.get(paperId) ?? []), { at: claim.at, ...found }]);
      if (claim.paperIds.length === 1 && !alone.has(paperId)) alone.set(paperId, { at: claim.at, ...found });
    }
  }

  return citations.map((citation) => {
    if (citation.sourceType === "web") return citation;
    const paperId = citationPaperId(citation);
    const passages = byPaper.get(paperId) ?? [];
    let primary: CitationPassage | null = alone.get(paperId) ?? passages[0] ?? null;
    if (!primary) {
      const about = (sources.claims?.get(paperId) ?? []).join("\n").trim();
      const paper = about ? windowsFor(paperId) : null;
      primary = paper ? bestPassage(about, paper) : null;
    }
    if (!primary) return citation;
    return {
      ...citation,
      quote: primary.quote,
      ...(primary.section ? { section: primary.section } : {}),
      ...(passages.length ? { passages } : {}),
    };
  });
}

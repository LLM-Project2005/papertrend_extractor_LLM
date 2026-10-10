/**
 * How much of each paper an answer reads.
 *
 * An answer used to see one passage of at most 1,400 characters from each
 * paper, and a paper-by-paper explanation the first 900-1,200 characters of
 * four stored parts: about a twentieth of a 7,000-word article. Asked to
 * "explain this paper", the chat said the paper's "methods description is
 * truncated" (the test account's chat, 2026-10-09). The answer model takes a
 * million tokens at $0.10 a million, so a whole paper (about 13,000 tokens)
 * costs about a tenth of a cent to read.
 *
 * A paper is laid out by its printed sections, without its references or
 * acknowledgements. When the papers fit the effort's budget they are read
 * whole. Otherwise each gets a fair share - a paper that needs less gives the
 * rest back - filled with its abstract and then the passages that best match
 * the question, put back in reading order with a mark where text was left out.
 */
import type { ChatEffort } from "@/lib/chat-effort";
import { splitPaperSections, type PaperSectionKey } from "@/lib/paper-sections";
import { normalizeRepositoryText, splitTextPassages, tokenizeRepositoryText } from "@/lib/repository-text";

export interface ReadablePaper {
  paperId: string;
  title: string;
  year: string;
  abstract: string;
  methods: string;
  results: string;
  conclusion: string;
  content: string;
  contentSource: "full_text" | "extracted_sections" | "empty";
}

export interface PaperPart {
  label: string;
  text: string;
}

export interface PaperReading {
  paperId: string;
  /** The paper's text as the model is given it, under its section headings. */
  text: string;
  /** True when nothing but references and acknowledgements was left out. */
  whole: boolean;
}

/**
 * Characters of paper text one answer reads at each effort: at Medium about
 * one whole paper, or a few thousand characters from each of ten; at High
 * about three whole papers.
 */
export const READING_BUDGET: Record<ChatEffort, number> = {
  low: 16_000,
  medium: 48_000,
  high: 140_000,
};

/** An abstract states the result, so it is read first and whole up to this length. */
const ABSTRACT_CHARS = 2_200;
const PIECE_CHARS = 900;
const GAP = "[…]";

const LEFT_OUT: ReadonlySet<PaperSectionKey> = new Set(["references", "acknowledgements"]);

const STOPWORDS = new Set([
  "a", "about", "across", "an", "and", "any", "are", "as", "at", "be", "been", "between", "both", "by", "can", "do",
  "does", "for", "from", "has", "have", "how", "in", "into", "is", "it", "its", "of", "on", "or", "paper", "papers",
  "study", "studies", "that", "the", "their", "these", "this", "those", "to", "was", "were", "what", "when", "where",
  "which", "who", "why", "with", "within", "research", "repository", "explain", "describe", "summarise", "summarize",
  "compare", "tell", "me", "please", "show", "give",
]);

function termsOf(text: string): string[] {
  return tokenizeRepositoryText(text).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** A reference list printed without a heading the section splitter knows, cut from the end of the text. */
function withoutReferenceList(text: string): string {
  const heading = /^[ \t]*(?:#+[ \t]*)?(?:\*\*)?(?:references|bibliography|works cited|เอกสารอ้างอิง|บรรณานุกรม)(?:\*\*)?[ \t]*:?[ \t]*$/gim;
  let cut = -1;
  for (const match of text.matchAll(heading)) cut = match.index ?? cut;
  return cut > text.length * 0.5 ? text.slice(0, cut).trim() : text.trim();
}

/** A paper's parts in reading order: its printed sections, or the four parts the analysis stored. */
export function paperParts(paper: ReadablePaper): PaperPart[] {
  if (paper.contentSource === "full_text" && paper.content.trim()) {
    const sections = splitPaperSections(paper.content);
    if (sections) {
      return sections
        .filter((section) => !LEFT_OUT.has(section.key))
        .map((section) => ({
          label: section.key === "front_matter" ? "Title page" : section.heading.trim() || "Text",
          text: section.text.trim(),
        }))
        .filter((part) => part.text);
    }
    return [{ label: "Text", text: withoutReferenceList(paper.content) }];
  }
  return (
    [
      ["Abstract", paper.abstract],
      ["Methods", paper.methods],
      ["Results", paper.results],
      ["Conclusion", paper.conclusion],
    ] as const
  )
    .filter(([, text]) => text.trim())
    .map(([label, text]) => ({ label, text: text.trim() }));
}

function layout(parts: PaperPart[]): string {
  return parts.map((part) => `### ${part.label}\n${part.text}`).join("\n\n");
}

/** Whole sentences grouped to about `target` characters, without overlap. */
function chunks(text: string, target: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const block = paragraph.replace(/\s+/g, " ").trim();
    if (!block) continue;
    const sentences = /[ก-๛]/.test(block)
      ? splitTextPassages(block, { targetLength: target, minLength: 1 })
      : block.split(/(?<=[.!?])\s+(?=[\p{Lu}\d(“"])/u);
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > target) {
        out.push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

interface Piece {
  part: number;
  order: number;
  text: string;
  terms: Map<string, number>;
  length: number;
  score: number;
}

function isAbstract(label: string): boolean {
  return /abstract|บทคัดย่อ|summary/i.test(label);
}

/** Where a passage with no words of the question is still worth reading: results and conclusions first. */
function partPriority(label: string): number {
  if (/conclu|สรุป/i.test(label)) return 3;
  if (/result|finding|discussion|ผล|อภิปราย/i.test(label)) return 2;
  if (/method|procedure|participant|data|วิธี/i.test(label)) return 1;
  return 0;
}

/**
 * Lays each paper out for an answer to read within `budget` characters of
 * paper text, in the order given.
 */
export function readPapers(papers: ReadablePaper[], queries: string[], budget: number): PaperReading[] {
  const parts = papers.map(paperParts);
  const full = parts.map(layout);
  const total = full.reduce((sum, text) => sum + text.length, 0);
  if (total <= budget) {
    return papers.map((paper, index) => ({ paperId: paper.paperId, text: full[index], whole: true }));
  }

  // A fair share each; a paper shorter than its share is read whole and leaves the rest to the others.
  const shares = new Array<number>(papers.length).fill(0);
  let remaining = budget;
  let open = papers.length;
  for (const index of full.map((_, i) => i).sort((a, b) => full[a].length - full[b].length)) {
    const fair = remaining / open;
    shares[index] = Math.min(full[index].length, Math.floor(fair));
    remaining -= shares[index];
    open -= 1;
  }

  // One index over every paper's passages, so a word common to all of them counts for little.
  const pieces: Piece[][] = parts.map((paperParts) =>
    paperParts.flatMap((part, partIndex) =>
      chunks(part.text, PIECE_CHARS).map((text, order) => {
        const tokens = termsOf(text);
        const terms = new Map<string, number>();
        for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
        return { part: partIndex, order, text, terms, length: tokens.length, score: 0 };
      })
    )
  );
  const all = pieces.flat();
  const documentFrequency = new Map<string, number>();
  for (const piece of all) for (const term of piece.terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const averageLength = all.length ? all.reduce((sum, piece) => sum + piece.length, 0) / all.length : 1;
  const queryTerms = [...new Set(queries.map((query) => query.trim()).filter(Boolean))]
    .slice(0, 10)
    .map((query) => ({ terms: [...new Set(termsOf(query))], phrase: normalizeRepositoryText(query).trim() }))
    .filter((query) => query.terms.length > 0);
  for (const piece of all) {
    let best = 0;
    for (const query of queryTerms) {
      let score = 0;
      for (const term of query.terms) {
        const tf = piece.terms.get(term);
        if (!tf) continue;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (all.length - df + 0.5) / (df + 0.5));
        score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * piece.length) / averageLength)));
      }
      if (score > 0 && query.terms.length >= 2 && query.phrase.length >= 6 && normalizeRepositoryText(piece.text).includes(query.phrase)) score *= 1.5;
      best = Math.max(best, score);
    }
    piece.score = best;
  }

  return papers.map((paper, index) => {
    if (shares[index] >= full[index].length) return { paperId: paper.paperId, text: full[index], whole: true };
    const share = shares[index];
    const paperPieces = pieces[index];
    const chosen = new Set<Piece>();
    let used = 0;
    const take = (piece: Piece) => {
      if (chosen.has(piece) || used + piece.text.length > share) return;
      chosen.add(piece);
      used += piece.text.length + 1;
    };
    // The abstract first, whole up to its limit.
    for (const piece of paperPieces) {
      if (!isAbstract(parts[index][piece.part].label)) continue;
      if (used + piece.text.length > Math.min(share, ABSTRACT_CHARS)) break;
      take(piece);
    }
    const ranked = [...paperPieces].sort(
      (a, b) =>
        b.score - a.score ||
        partPriority(parts[index][b.part].label) - partPriority(parts[index][a.part].label) ||
        a.part - b.part ||
        a.order - b.order
    );
    for (const piece of ranked) {
      if (share - used < 120) break;
      take(piece);
    }
    const kept = [...chosen].sort((a, b) => a.part - b.part || a.order - b.order);
    const partLength = (part: number) => paperPieces.filter((piece) => piece.part === part).length;
    const lines: string[] = [];
    let previous: Piece | null = null;
    for (const piece of kept) {
      if (!previous || previous.part !== piece.part) {
        if (previous && previous.order + 1 < partLength(previous.part)) lines.push(GAP);
        lines.push(`${lines.length ? "\n" : ""}### ${parts[index][piece.part].label}`);
        if (piece.order > 0) lines.push(GAP);
      } else if (piece.order !== previous.order + 1) {
        lines.push(GAP);
      }
      lines.push(piece.text);
      previous = piece;
    }
    if (previous && previous.order + 1 < partLength(previous.part)) lines.push(GAP);
    return { paperId: paper.paperId, text: lines.join("\n"), whole: false };
  });
}

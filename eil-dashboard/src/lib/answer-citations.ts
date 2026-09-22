/**
 * Turns the inline citations in an answer into footnote markers.
 *
 * The server renders `[Paper 12]` as a readable parenthetical - "(Enhancing
 * Learner Autonomy amongst Young EFL Learners in…, 2017)" - because a bare
 * database id tells a reader nothing. Read aloud in the middle of a sentence,
 * though, a 60-character title is an interruption, and a paragraph making three
 * claims carries three of them.
 *
 * So the text keeps the parenthetical and the reader gets a numbered marker.
 * The transformation happens here rather than on the server on purpose: the
 * answer stored in the thread, exported, or scored by the judge stays readable
 * as plain text, and only the rendered view is compacted. The judge penalises
 * leaked markup, so an answer full of `[Paper 12]` would score worse even
 * though it renders identically.
 */

/** Longest a title may run inside a citation before it is shortened. */
export const CITATION_TITLE_MAX = 58;

/**
 * The exact label the server writes into an answer's parentheses.
 *
 * Shared with the server so the two cannot drift: the renderer finds citations
 * by matching this string, and a difference of one character would silently
 * leave the parenthetical in place with no footnote.
 */
export function citationLabel(paper: { title: string; year?: string | null }): string {
  const title = paper.title.trim() || "Untitled paper";
  const short =
    title.length > CITATION_TITLE_MAX
      ? `${title.slice(0, CITATION_TITLE_MAX - 1).trimEnd()}…`
      : title;
  const year = paper.year && paper.year !== "Unknown" ? `, ${paper.year}` : "";
  return `${short}${year}`;
}

export interface CitationSource {
  paperId: string;
  title: string;
  year: string;
  href: string;
  /** 1-based position in this message's source list, as shown to the reader. */
  number: number;
}

export interface MarkedAnswer {
  /** The answer with each citation replaced by a `[[cite:n,n]]` marker. */
  text: string;
  /** Every source referenced by a marker, in the order they first appear. */
  sources: CitationSource[];
}

/** Internal marker, never shown: the renderer swaps it for superscripts. */
export const CITATION_MARKER = /\[\[cite:([\d,]+)\]\]/g;

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces the rendered parentheticals with markers, numbering as it goes.
 *
 * Numbering follows first appearance in the text rather than the order the
 * retrieval happened to return, because that is the order a reader meets them.
 */
export function markCitations(
  answer: string,
  citations: Array<{ paperId: string; title: string; year: string; href: string }>
): MarkedAnswer {
  if (!answer || citations.length === 0) return { text: answer, sources: [] };

  const byLabel = new Map<string, (typeof citations)[number]>();
  for (const citation of citations) {
    byLabel.set(citationLabel(citation), citation);
  }
  // Longest first, so a title that is a prefix of another cannot match first.
  const labels = [...byLabel.keys()].sort((left, right) => right.length - left.length);
  if (labels.length === 0) return { text: answer, sources: [] };

  const assigned = new Map<string, CitationSource>();
  const group = new RegExp(
    `\\((${labels.map(escapeForRegex).join("|")})(?:;\\s*(?:${labels.map(escapeForRegex).join("|")}))*\\)`,
    "g"
  );

  const text = answer.replace(group, (whole) => {
    const inner = whole.slice(1, -1);
    const parts = inner.split(/;\s*/).map((part) => part.trim());
    const numbers: number[] = [];
    for (const part of parts) {
      const citation = byLabel.get(part);
      if (!citation) return whole;
      let source = assigned.get(citation.paperId);
      if (!source) {
        source = {
          paperId: citation.paperId,
          title: citation.title,
          year: citation.year,
          href: citation.href,
          number: assigned.size + 1,
        };
        assigned.set(citation.paperId, source);
      }
      if (!numbers.includes(source.number)) numbers.push(source.number);
    }
    if (numbers.length === 0) return whole;
    return `[[cite:${numbers.join(",")}]]`;
  });

  return {
    text,
    sources: [...assigned.values()].sort((left, right) => left.number - right.number),
  };
}

/** Above this length an answer is folded, with the opening always visible. */
export const FOLD_THRESHOLD_CHARS = 2_400;

/** How much of a folded answer stays on screen. */
export const FOLD_VISIBLE_CHARS = 1_200;

/**
 * Where to cut a long answer so the fold does not split it mid-thought.
 *
 * Returns the index to cut at, preferring a blank line, then a sentence end,
 * then a space, so the visible part always ends somewhere a reader can stop.
 * Returns null when the answer is short enough to show whole.
 */
export function foldPoint(
  answer: string,
  threshold: number = FOLD_THRESHOLD_CHARS,
  visible: number = FOLD_VISIBLE_CHARS
): number | null {
  if (answer.length <= threshold) return null;
  const window = answer.slice(0, visible);
  const paragraph = window.lastIndexOf("\n\n");
  // Only honour a paragraph break past the halfway mark, or a long opening
  // paragraph would collapse the visible part to almost nothing.
  if (paragraph > visible / 2) return paragraph;
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("ๆ "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! ")
  );
  if (sentence > visible / 2) return sentence + 1;
  const space = window.lastIndexOf(" ");
  return space > visible / 2 ? space : visible;
}

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

/** A passage of a paper, quoted for a claim that cites it (citation-passages.ts). */
export interface CitationPassage {
  /** One to three of the paper's sentences, as the text the answer read has them. */
  quote: string;
  /** The printed section it sits in, when the paper's headings were found. */
  section?: string;
}

/**
 * The passage behind one citation marker. `at` is the marker's place among the
 * answer's markers, counted from 0 in reading order as markCitations makes
 * them, so the server and the renderer agree on which marker it belongs to.
 */
export interface MarkerPassage extends CitationPassage {
  at: number;
}

/** What a citation carries about the passages behind it. */
export interface CitationPassageFields {
  /** The passage behind the first claim that cites the paper. */
  quote?: string;
  section?: string;
  /** The passage behind each marker that cites the paper, where one was found. */
  passages?: MarkerPassage[];
}

export interface CitationSource extends CitationPassageFields {
  paperId: string;
  title: string;
  year: string;
  href: string;
  /** 1-based position in this message's source list, as shown to the reader. */
  number: number;
}

/**
 * A stored citation's passage fields, kept only when they have the shape the
 * server writes. Citations come back from the database as plain JSON, and
 * older ones have none of these.
 */
export function citationPassageFields(citation: {
  quote?: unknown;
  section?: unknown;
  passages?: unknown;
}): CitationPassageFields {
  const fields: CitationPassageFields = {};
  if (typeof citation.quote === "string" && citation.quote.trim()) {
    fields.quote = citation.quote;
    if (typeof citation.section === "string" && citation.section.trim()) fields.section = citation.section;
  }
  if (Array.isArray(citation.passages)) {
    const passages = citation.passages.filter(
      (passage): passage is MarkerPassage =>
        Boolean(passage) &&
        typeof (passage as MarkerPassage).quote === "string" &&
        Number.isInteger((passage as MarkerPassage).at)
    );
    if (passages.length) fields.passages = passages;
  }
  return fields;
}

/**
 * The passage to show for a marker. When the marker's place is known and the
 * citation lists passages by marker, only that marker's passage will do: a
 * passage found for another sentence would seem to support this one. Without
 * a place (an older report) the citation's own quote stands for the paper.
 */
export function passageForMarker(source: CitationPassageFields, at?: number): CitationPassage | null {
  if (at !== undefined && source.passages?.length) {
    const found = source.passages.find((passage) => passage.at === at);
    return found ? { quote: found.quote, ...(found.section ? { section: found.section } : {}) } : null;
  }
  return source.quote ? { quote: source.quote, ...(source.section ? { section: source.section } : {}) } : null;
}

/**
 * Gives each marker its place in the answer: `[[cite:1,2]]` becomes
 * `[[cite:1,2@0]]`. The renderer meets markers one paragraph at a time and
 * cannot count them itself.
 */
export function numberCitationMarkers(text: string): string {
  let at = 0;
  return text.replace(/\[\[cite:([\d,]+)\]\]/g, (_whole, numbers: string) => `[[cite:${numbers}@${at++}]]`);
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
  citations: Array<{ paperId: string; title: string; year: string; href: string } & CitationPassageFields>
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
  const assign = (citation: (typeof citations)[number]): number => {
    let source = assigned.get(citation.paperId);
    if (!source) {
      source = {
        paperId: citation.paperId,
        title: citation.title,
        year: citation.year,
        href: citation.href,
        number: assigned.size + 1,
        ...citationPassageFields(citation),
      };
      assigned.set(citation.paperId, source);
    }
    return source.number;
  };
  const group = new RegExp(
    `\\((${labels.map(escapeForRegex).join("|")})(?:;\\s*(?:${labels.map(escapeForRegex).join("|")}))*\\)`,
    "g"
  );

  const withParentheticals = answer.replace(group, (whole) => {
    const inner = whole.slice(1, -1);
    const parts = inner.split(/;\s*/).map((part) => part.trim());
    const numbers: number[] = [];
    for (const part of parts) {
      const citation = byLabel.get(part);
      if (!citation) return whole;
      const number = assign(citation);
      if (!numbers.includes(number)) numbers.push(number);
    }
    if (numbers.length === 0) return whole;
    return `[[cite:${numbers.join(",")}]]`;
  });

  // Reports written before the server learned to render citations still carry
  // the raw `[Paper 3606803487645584445]` form, sometimes several to a bracket.
  // An id this message cites becomes the same numbered marker; a bracket that
  // names none of its sources is left as written rather than guessed at.
  const byId = new Map(citations.map((citation) => [citation.paperId, citation]));
  const text = withParentheticals.replace(LEGACY_CITATION_GROUP, (whole, inner: string) => {
    const ids = inner.split(/\s*[,;]\s*/).map((part) => part.replace(/^Paper\s+/i, "").trim());
    const known = ids.map((id) => byId.get(id)).filter((citation): citation is (typeof citations)[number] => Boolean(citation));
    if (known.length === 0) return whole;
    const numbers = [...new Set(known.map(assign))];
    return `[[cite:${numbers.join(",")}]]`;
  });

  return {
    text,
    sources: [...assigned.values()].sort((left, right) => left.number - right.number),
  };
}

/**
 * A citation's paper id, exactly.
 *
 * Paper ids are 18-digit integers. Deep research stored some citations with the
 * id as a JSON number, and a JavaScript number cannot hold 18 digits, so
 * 654436454321652795 arrived as 654436454321652700 and matched nothing in the
 * report's text. The citation's link was written as a string and kept every
 * digit, so the id is read from there first.
 */
export function citationPaperId(citation: { paperId?: unknown; href?: unknown }): string {
  const fromHref = /[?&]paperId=(\d+)/.exec(String(citation.href ?? ""))?.[1];
  return fromHref ?? String(citation.paperId ?? "");
}

/** `[Paper 12]`, `[Paper 12, Paper 34]` or `[Paper 12; 34]`, as older reports wrote them. */
const LEGACY_CITATION_GROUP = /\[(Paper\s+\d{1,24}(?:\s*[,;]\s*(?:Paper\s+)?\d{1,24})*)\]/gi;

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

/*
 * References export (docs/32, 4.4): papers as BibTeX, RIS and APA text.
 *
 * The analysis keeps a paper's title and year, not its authors or venue.
 * Those come from Crossref, which already receives titles and DOIs under the
 * privacy policy: by the paper's DOI when it prints one (or the year lookup
 * found one), else by a strict title match, the same rule the worker's year
 * lookup uses. A paper Crossref does not know is exported with its title and
 * year only, and says so. Pure functions here; the lookups are in resolve.ts.
 */

export type CitationType = "article" | "conference" | "chapter" | "book" | "thesis" | "report" | "other";

export interface CitationAuthor {
  family: string;
  given?: string;
}

export interface CitationRecord {
  type: CitationType;
  title: string;
  year: string | null;
  authors: CitationAuthor[];
  /** Journal, proceedings or book the work appeared in. */
  container: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  doi: string | null;
  /** Where the authors and venue came from; "paper" means only the analysis's title and year. */
  source: "crossref" | "paper";
}

export type ReferenceFormat = "bibtex" | "ris" | "apa";

/* --------------------------------------------------------------- finding */

export const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;

export function normalizeDoi(value: string | null | undefined): string | null {
  const match = DOI_PATTERN.exec(String(value ?? ""));
  return match ? match[0].replace(/[.,;:)]+$/, "").toLowerCase() : null;
}

/** The DOI the year lookup recorded in papers.year_source, e.g. "web:crossref:doi:10.1/x". */
export function doiFromYearSource(yearSource: string | null | undefined): string | null {
  const match = /^web:crossref:(?:doi|title):(.+)$/.exec(String(yearSource ?? ""));
  return match ? normalizeDoi(match[1]) : null;
}

/**
 * The paper's own DOI from its first pages, never one from its references:
 * the text before a References heading, a DOI labelled as one, or a single
 * bare DOI near the top (as the worker's extract_primary_doi decides).
 */
export function primaryDoiFromText(rawText: string | null | undefined): string | null {
  let front = String(rawText ?? "").slice(0, 8000);
  const references = /\b(?:references|bibliography)\b/i.exec(front);
  if (references) front = front.slice(0, references.index);
  const pattern = new RegExp(DOI_PATTERN.source, "gi");
  const matches = [...front.matchAll(pattern)];
  if (matches.length === 0) return null;
  const labelled = matches.filter((match) => {
    const index = match.index ?? 0;
    return /\bdoi\b|doi\.org/i.test(front.slice(Math.max(0, index - 80), index + match[0].length + 80));
  });
  if (labelled.length === 1) return normalizeDoi(labelled[0][0]);
  if (matches.length === 1 && (matches[0].index ?? 0) < 2500) return normalizeDoi(matches[0][0]);
  return null;
}

/* ---------------------------------------------------------- title matching */

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Ratcliff-Obershelp similarity, as Python's SequenceMatcher.ratio() computes it. */
function sequenceRatio(left: string, right: string): number {
  const matches = (a: string, b: string): number => {
    if (!a || !b) return 0;
    let bestLength = 0;
    let bestA = 0;
    let bestB = 0;
    const lengths = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = 0;
      for (let j = 1; j <= b.length; j += 1) {
        const saved = lengths[j];
        lengths[j] = a[i - 1] === b[j - 1] ? previous + 1 : 0;
        if (lengths[j] > bestLength) {
          bestLength = lengths[j];
          bestA = i - bestLength;
          bestB = j - bestLength;
        }
        previous = saved;
      }
    }
    if (bestLength === 0) return 0;
    return (
      bestLength +
      matches(a.slice(0, bestA), b.slice(0, bestB)) +
      matches(a.slice(bestA + bestLength), b.slice(bestB + bestLength))
    );
  };
  const total = left.length + right.length;
  return total === 0 ? 0 : (2 * matches(left, right)) / total;
}

export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  const shared = [...tokensA].filter((token) => tokensB.has(token)).length;
  const token = shared / Math.max(1, new Set([...tokensA, ...tokensB]).size);
  return sequenceRatio(a, b) * 0.6 + token * 0.4;
}

export interface CrossrefWork {
  DOI?: string;
  type?: string;
  title?: string[];
  author?: Array<{ family?: string; given?: string; name?: string }>;
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  issued?: { "date-parts"?: Array<Array<number | null>> };
  "published-print"?: { "date-parts"?: Array<Array<number | null>> };
  "published-online"?: { "date-parts"?: Array<Array<number | null>> };
}

export function crossrefYear(work: CrossrefWork): string | null {
  for (const key of ["published-print", "published-online", "issued"] as const) {
    const year = work[key]?.["date-parts"]?.[0]?.[0];
    if (typeof year === "number" && year > 1000 && year < 3000) return String(year);
  }
  return null;
}

/**
 * The one Crossref result that is this paper, or none: an exact title, or a
 * near one well ahead of the next result, and a year within one of the
 * paper's (the worker's rule, plus the year check).
 */
export function strictTitleMatch(title: string, year: string | null, works: CrossrefWork[]): CrossrefWork | null {
  if (normalizeTitle(title).length < 20) return null;
  const ranked = works
    .map((work) => ({ work, score: titleSimilarity(title, work.title?.[0] ?? "") }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const [best, second] = ranked;
  if (!best) return null;
  const margin = second ? best.score - second.score : 1;
  if (best.score < 0.985 && (best.score < 0.93 || margin < 0.04)) return null;
  const found = crossrefYear(best.work);
  if (year && /^\d{4}$/.test(year) && found && Math.abs(Number(found) - Number(year)) > 1) return null;
  return best.work;
}

/* ---------------------------------------------------------------- records */

const TYPES: Record<string, CitationType> = {
  "journal-article": "article",
  "proceedings-article": "conference",
  "book-chapter": "chapter",
  "book-section": "chapter",
  "book-part": "chapter",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  dissertation: "thesis",
  report: "report",
  "report-component": "report",
};

const clean = (value: string | null | undefined): string | null => {
  const text = String(value ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return text || null;
};

/*
 * Some publishers deposit affiliations, email addresses and titles as authors
 * of their own ("Chulalongkorn University, Bangkok, Thailand", "Asst. Prof.").
 * A part of a person's name has no "@", digit or comma, and is not one of
 * these words.
 */
const NOT_A_NAME = /[@\d,]|\b(?:universit\w*|faculty|department|institute|college|school|centre|center|ministry|prof\.?|asst\.?|assoc\.?|ph\.?\s?d\.?|dr\.)(?=\s|$|\.)/i;

export function plausibleAuthor(author: CitationAuthor): boolean {
  const parts = [author.family, author.given ?? ""];
  return Boolean(author.family) && parts.every((part) => !NOT_A_NAME.test(part) && part.split(/\s+/).length <= 5);
}

/** The paper's details from Crossref; its own title or year where a reader corrected it. */
export function citationFromCrossref(
  work: CrossrefWork,
  paper: { title: string | null; year: string | null; correctedTitle?: string | null; correctedYear?: string | null }
): CitationRecord {
  const authors = (work.author ?? [])
    .map((author) => ({ family: clean(author.family) ?? clean(author.name) ?? "", given: clean(author.given) ?? undefined }))
    .filter(plausibleAuthor);
  return {
    type: TYPES[work.type ?? ""] ?? "other",
    title: clean(paper.correctedTitle) ?? clean(work.title?.[0]) ?? clean(paper.title) ?? "Untitled",
    year: (paper.correctedYear && /^\d{4}$/.test(paper.correctedYear) ? paper.correctedYear : null) ?? crossrefYear(work) ?? paper.year,
    authors,
    container: clean(work["container-title"]?.[0]),
    volume: clean(work.volume),
    issue: clean(work.issue),
    pages: clean(work.page)?.replace(/[–—-]+/g, "-") ?? null,
    publisher: clean(work.publisher),
    doi: normalizeDoi(work.DOI),
    source: "crossref",
  };
}

/** A paper Crossref does not know: what the analysis recorded. */
export function citationFromPaper(paper: { title: string | null; year: string | null }): CitationRecord {
  return {
    type: "other",
    title: clean(paper.title) ?? "Untitled",
    year: paper.year && /^\d{4}$/.test(paper.year) ? paper.year : null,
    authors: [],
    container: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    doi: null,
    source: "paper",
  };
}

/* ---------------------------------------------------------------- BibTeX */

function latin(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** smith2019peer: first author, year, first word of the title; made unique with a, b, c. */
export function citationKey(record: CitationRecord, used: Set<string>): string {
  const author = latin(record.authors[0]?.family ?? "") || "anon";
  const word = normalizeTitle(record.title).split(" ").map(latin).find((token) => token.length > 3) ?? "paper";
  const base = `${author}${record.year ?? "nd"}${word}`;
  let key = base;
  for (let index = 0; used.has(key); index += 1) key = `${base}${String.fromCharCode(97 + (index % 26))}${index >= 26 ? index : ""}`;
  used.add(key);
  return key;
}

function bibtexText(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_])/g, "\\$1")
    .replace(/([{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

const BIBTEX_TYPES: Record<CitationType, string> = {
  article: "article",
  conference: "inproceedings",
  chapter: "incollection",
  book: "book",
  thesis: "phdthesis",
  report: "techreport",
  other: "misc",
};

export function toBibTeX(records: CitationRecord[]): string {
  const used = new Set<string>();
  return records
    .map((record) => {
      const fields: Array<[string, string | null]> = [
        ["author", record.authors.length ? record.authors.map((author) => (author.given ? `${author.family}, ${author.given}` : author.family)).join(" and ") : null],
        ["title", record.title],
        [record.type === "article" ? "journal" : record.type === "conference" || record.type === "chapter" ? "booktitle" : record.type === "thesis" ? "school" : record.type === "report" ? "institution" : "howpublished", record.container ?? (record.type === "thesis" || record.type === "report" ? record.publisher : null)],
        ["year", record.year],
        ["volume", record.volume],
        ["number", record.issue],
        ["pages", record.pages?.replace(/-/g, "--") ?? null],
        ["publisher", record.type === "thesis" || record.type === "report" ? null : record.publisher],
        ["doi", record.doi],
        ["note", record.source === "paper" ? "Authors and venue not found; title and year from the paper" : null],
      ];
      const body = fields
        .filter((field): field is [string, string] => Boolean(field[1]))
        // The title in a second pair of braces keeps its capitals; a DOI is written as it is.
        .map(([name, value]) => `  ${name} = {${name === "title" ? `{${bibtexText(value)}}` : name === "doi" ? value : bibtexText(value)}},`)
        .join("\n");
      return `@${BIBTEX_TYPES[record.type]}{${citationKey(record, used)},\n${body}\n}`;
    })
    .join("\n\n")
    .concat(records.length ? "\n" : "");
}

/* -------------------------------------------------------------------- RIS */

const RIS_TYPES: Record<CitationType, string> = {
  article: "JOUR",
  conference: "CPAPER",
  chapter: "CHAP",
  book: "BOOK",
  thesis: "THES",
  report: "RPRT",
  other: "GEN",
};

export function toRIS(records: CitationRecord[]): string {
  return records
    .map((record) => {
      const [start, end] = (record.pages ?? "").split("-");
      const lines: Array<[string, string | null | undefined]> = [
        ["TY", RIS_TYPES[record.type]],
        ...record.authors.map((author): [string, string] => ["AU", author.given ? `${author.family}, ${author.given}` : author.family]),
        ["TI", record.title],
        ["T2", record.container],
        ["PY", record.year],
        ["VL", record.volume],
        ["IS", record.issue],
        ["SP", start || null],
        ["EP", end || null],
        ["PB", record.publisher],
        ["DO", record.doi],
        ["UR", record.doi ? `https://doi.org/${record.doi}` : null],
        ["N1", record.source === "paper" ? "Authors and venue not found; title and year from the paper." : null],
      ];
      return [...lines.filter(([, value]) => value), ["ER", ""]].map(([tag, value]) => `${tag}  - ${value}`.trimEnd()).join("\r\n");
    })
    .join("\r\n\r\n")
    .concat(records.length ? "\r\n" : "");
}

/* -------------------------------------------------------------------- APA */

function initials(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .map((piece) => (piece ? `${piece[0].toUpperCase()}.` : ""))
        .join("-")
    )
    .join(" ");
}

/** APA 7: up to 20 authors, "&" before the last; 21 or more, the first 19, an ellipsis, the last. */
function apaAuthors(authors: CitationAuthor[]): string {
  const names = authors.map((author) => (author.given ? `${author.family}, ${initials(author.given)}` : author.family));
  if (names.length === 1) return names[0];
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, . . . ${names[names.length - 1]}`;
}

const sentenceEnd = (value: string) => (/[.?!]$/.test(value) ? value : `${value}.`);

/** One APA 7 reference, as plain text (a reference manager adds the italics). */
export function apaReference(record: CitationRecord): string {
  const year = `(${record.year ?? "n.d."}).`;
  const title = sentenceEnd(record.title);
  const doi = record.doi ? ` https://doi.org/${record.doi}` : "";
  let source = "";
  if (record.type === "article" && record.container) {
    source = ` ${record.container}${record.volume ? `, ${record.volume}` : ""}${record.issue ? `(${record.issue})` : ""}${record.pages ? `, ${record.pages.replace(/-/g, "–")}` : ""}.`;
  } else if ((record.type === "chapter" || record.type === "conference") && record.container) {
    source = ` In ${record.container}${record.pages ? ` (pp. ${record.pages.replace(/-/g, "–")})` : ""}.${record.publisher ? ` ${sentenceEnd(record.publisher)}` : ""}`;
  } else if (record.type === "thesis") {
    source = record.publisher ? ` [Thesis, ${record.publisher}].` : "";
  } else if (record.publisher) {
    source = ` ${sentenceEnd(record.publisher)}`;
  } else if (record.container) {
    source = ` ${sentenceEnd(record.container)}`;
  }
  // No author: the title takes the author's place (APA 7, 9.12).
  return record.authors.length
    ? `${apaAuthors(record.authors)} ${year} ${title}${source}${doi}`
    : `${title} ${year}${source}${doi}`;
}

/** The reference list: sorted by first author (or title), as APA asks. */
export function toAPA(records: CitationRecord[]): string {
  const sortKey = (record: CitationRecord) => (record.authors[0]?.family ?? record.title).toLocaleLowerCase();
  return [...records]
    .sort((left, right) => sortKey(left).localeCompare(sortKey(right)) || (left.year ?? "").localeCompare(right.year ?? ""))
    .map(apaReference)
    .join("\n\n")
    .concat(records.length ? "\n" : "");
}

export function formatReferences(records: CitationRecord[], format: ReferenceFormat): string {
  return format === "bibtex" ? toBibTeX(records) : format === "ris" ? toRIS(records) : toAPA(records);
}

export const REFERENCE_FILE_EXTENSION: Record<ReferenceFormat, string> = { bibtex: "bib", ris: "ris", apa: "txt" };

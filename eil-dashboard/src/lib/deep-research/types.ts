/*
 * Max effort's research engine (2026-10-10, replacing deep research v2's
 * passage search): the shapes a run passes between its steps.
 *
 * A run reads the papers that bear on the question whole - one step per paper
 * - and records what each reports, with the paper's own words for every fact;
 * code checks each quote and number against the paper; one answer is written
 * from the facts that passed; and code checks every number and citation in it.
 * Each step's result is saved before the next begins, so a run that is
 * interrupted resumes where it stopped.
 *
 * Measured against High on the test repository, v2 read 1,100-character
 * passages (12-30k characters an answer) and lost to High on two of four
 * questions: it credited papers with the studies they cite and said papers did
 * not report what they did.
 */

/** Marks a run of this engine, in its write step and on its answer. */
export const ENGINE = "max-reader-v1";

/** A session of the research engine (its steps are dr2_*), as opposed to the old worker's. */
export function isV2Session(session: { steps?: Array<{ tool_name?: string | null }> } | null | undefined): boolean {
  return Boolean(session?.steps?.some((step) => String(step.tool_name ?? "").startsWith("dr2_")));
}

/** A session this engine planned and can run; v2's passage-search runs cannot be resumed by it. */
export function isCurrentEngine(
  session: { steps?: Array<{ tool_name?: string | null; input_payload?: unknown }> } | null | undefined
): boolean {
  const write = session?.steps?.find((step) => step.tool_name === "dr2_write");
  return (write?.input_payload as { engine?: unknown } | undefined)?.engine === ENGINE;
}

/** Server-side limits a request cannot raise. */
export const LIMITS = {
  /** Study cards the planner sees; a bigger scope is ranked first. */
  cards: 60,
  /** Papers read in one run, and how many of them whole; the rest in their main sections. */
  papers: 40,
  wholePapers: 16,
  /** Papers the ranking adds to the planner's choice, from its top eight. */
  rankingTop: 8,
  rankingAdds: 3,
  /** Characters of one paper read whole; a longer one is read in its main sections. */
  wholeChars: 160_000,
  partChars: 24_000,
  /** Facts kept from one paper. */
  factsPerPaper: 14,
  aspects: 8,
  webSearches: 2,
  /** Papers read at once. */
  concurrency: 6,
} as const;

export interface WebSearch {
  query: string;
  purpose: string;
}

export interface SelectedPaper {
  paperId: string;
  title: string;
  year: string;
  /** Why it bears on the question, in a few words. */
  reason: string;
  /** Chosen by the planner, or added from the ranking as a safety net. */
  via: "planner" | "ranking";
}

export interface ResearchPlan {
  title: string;
  /** "English", "Thai", ... - the language the answer is written in. */
  language: string;
  /** What to note from each paper: "participants and setting", "how writing was measured". */
  aspects: string[];
  /** Section headings for the answer, in its language. */
  outline: string[];
  /** English keywords, for ranking papers and choosing what to read in a long one. */
  searchTerms: string[];
  papers: SelectedPaper[];
  web: WebSearch[];
  source: "model" | "fallback";
}

/** One thing a paper reports, as read, with the sentence it comes from. */
export interface PaperFact {
  aspect: string;
  statement: string;
  /** The paper's own words, as printed. */
  quote: string;
  /** The heading the quote sits under. */
  section: string;
  /** False when the paper reports another study's result (its literature review). */
  own: boolean;
  kind: "finding" | "method" | "participants" | "measure" | "context" | "limitation" | "recommendation";
}

/** What one paper reports about the question, read and checked. */
export interface PaperRecord {
  paperId: string;
  title: string;
  year: string;
  /** True when the paper was read whole (references left out). */
  whole: boolean;
  relevant: boolean;
  facts: PaperFact[];
  /** Aspects asked about that the paper does not report; only a whole reading can say so. */
  notReported: string[];
  /** Facts dropped because their quote or a number is not in the paper. */
  unverified: number;
  /** The first few dropped, and why: kept on the step so a run can be looked into. */
  rejected?: Array<{ statement: string; quote: string; reason: string }>;
}

/** One piece of evidence a sentence can cite: a paper, a fact read from it, or a web page. */
export interface Evidence {
  /** "E1", "E2", ... - unique within a run. */
  id: string;
  kind: "paper" | "web";
  /** Paper id or URL. */
  sourceId: string;
  title: string;
  year: string;
  /** The quote (a fact), the paper's own opening (a paper), or the page's text. */
  text: string;
  /** What the quote shows, as read. */
  statement?: string;
  factKind?: PaperFact["kind"];
  /** False for what a paper reports about another study. */
  own?: boolean;
  section?: string;
  url?: string;
  /** A paper itself rather than one fact from it: cited for what it does not report. */
  record?: boolean;
  /** The paper was read whole. */
  whole?: boolean;
}

export interface AuditResult {
  checked: number;
  supported: number;
  rewritten: number;
  removed: number;
  unknownCitations: number;
  numberMismatches: number;
}

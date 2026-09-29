/*
 * Deep research v2 (docs/31): the shapes a run passes between its steps.
 *
 * A run is a plan of sub-questions, one gather step per sub-question, a report
 * written from what was gathered, and a check of every claim in it against
 * the passage it cites. Each step's result is saved before the next begins, so
 * a run that is interrupted resumes where it stopped.
 */

export const ENGINE = "deep-research-v2";

/** A session planned by this engine (its steps are dr2_*), as opposed to the old worker's. */
export function isV2Session(session: { steps?: Array<{ tool_name?: string | null }> } | null | undefined): boolean {
  return Boolean(session?.steps?.some((step) => String(step.tool_name ?? "").startsWith("dr2_")));
}

/** Server-side limits a request cannot raise. */
export const LIMITS = {
  subQuestions: 5,
  queriesPerQuestion: 4,
  candidatesPerQuestion: 16,
  /** The search's passages plus the abstracts of the papers they come from. */
  candidatesShown: 24,
  passagesPerQuestion: 8,
  webSearches: 4,
  passageChars: 1_100,
} as const;

export type SourceChoice = "papers" | "web" | "both";

export interface PlannedQuestion {
  id: string;
  question: string;
  /** Why answering it helps answer the reader's question. */
  purpose: string;
  sources: SourceChoice;
  /** Short keyword queries for the papers (and the web, when used). */
  queries: string[];
}

export interface ResearchPlan {
  title: string;
  /** "English", "Thai", ... - the language the report is written in. */
  language: string;
  questions: PlannedQuestion[];
  /** Whether counts of themes, methods and years across the papers help. */
  analytics: boolean;
  /** Section headings for the report, in the report's language. */
  outline: string[];
  source: "model" | "fallback";
}

/** One piece of evidence a claim can cite: a passage of a paper, a web page, or a computed fact. */
export interface Evidence {
  /** "E1", "E2", ... - unique within a run. */
  id: string;
  kind: "paper" | "web" | "fact";
  /** Paper id, URL, or fact id. */
  sourceId: string;
  title: string;
  year: string;
  /** The passage itself, as the reader could check it. */
  text: string;
  section?: string;
  url?: string;
  /** The sub-question it was gathered for. */
  questionId: string;
}

export interface Finding {
  statement: string;
  evidenceIds: string[];
  kind: "finding" | "contrast";
}

export interface GatherResult {
  questionId: string;
  question: string;
  evidence: Evidence[];
  findings: Finding[];
  /** What the searched papers (and pages) did not cover, in a sentence. */
  missing: string;
  coverage: "answered" | "partly" | "not_found";
  searchedPapers: number;
  webSearched: boolean;
  webFailed?: boolean;
  /** What the findings step was shown: label, source and title. */
  shown?: Array<{ label: string; source: string; title: string; section?: string }>;
}

export interface AuditResult {
  checked: number;
  supported: number;
  rewritten: number;
  removed: number;
  unknownCitations: number;
  numberMismatches: number;
}

/**
 * What the chat page tells a reader before they have asked anything.
 *
 * An empty chat page said "Where should we begin?" and nothing else. A reader
 * arriving for the first time could not tell what the assistant knows, what it
 * can be asked, what it will refuse, or how many of their papers a question
 * will search. Every one of those is knowable before a question is sent.
 *
 * The logic lives here rather than in the component so it can be tested, and so
 * the refusal list can be derived from the same place the server refuses rather
 * than written out a second time and left to drift.
 */

export interface GuidancePaper {
  paperId: string;
  title: string;
  year: string;
}

export interface ExampleQuestion {
  /** The question as it will be sent. */
  text: string;
  /** Why it is being offered, for the reader rather than for the model. */
  kind: "corpus" | "specific" | "comparison" | "count";
}

/** Below this a repository is too small for a comparison question to mean much. */
const COMPARISON_MINIMUM = 2;

function titleFragment(title: string, words = 6): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  // Thai writes without spaces, so a word count does not bound it; fall back to
  // characters when splitting on spaces does not actually split anything.
  const parts = trimmed.split(" ");
  if (parts.length <= 1) return trimmed.slice(0, 40);
  return parts.slice(0, words).join(" ");
}

/**
 * Three questions drawn from the reader's own repository.
 *
 * Generic examples ("what are the main themes?") teach nothing about what this
 * assistant can do with these papers. A question naming a paper the reader
 * recognises does, and it also proves the repository was read.
 */
export function exampleQuestions(
  papers: GuidancePaper[],
  scopeLabel: string
): ExampleQuestion[] {
  const usable = papers.filter((paper) => paper.title.trim().length > 0);
  const examples: ExampleQuestion[] = [];

  if (usable.length === 0) {
    return [
      { text: "How many papers are in this repository?", kind: "count" },
      { text: "List every paper title.", kind: "corpus" },
      { text: "What are the main research topics across these papers?", kind: "corpus" },
    ];
  }

  examples.push({
    text: `What are the main research topics across ${scopeLabel}?`,
    kind: "corpus",
  });

  const [first] = usable;
  examples.push({
    text: `What method did "${titleFragment(first.title)}" use, and what did it find?`,
    kind: "specific",
  });

  if (usable.length >= COMPARISON_MINIMUM) {
    examples.push({
      text: "Compare the methodologies used across these papers.",
      kind: "comparison",
    });
  } else {
    examples.push({ text: "How many words is each paper?", kind: "count" });
  }

  return examples;
}

export interface Capability {
  label: string;
  detail: string;
}

/**
 * What the assistant can answer, in the reader's terms rather than the
 * pipeline's. The operation names - `aggregate_corpus`, `search_evidence` -
 * are internal vocabulary and mean nothing to a researcher.
 */
export const CAPABILITIES: Capability[] = [
  {
    label: "Count and list",
    detail: "How many papers, which titles, which years, longest and shortest, word counts.",
  },
  {
    label: "Answer from the text",
    detail: "What a paper measured, concluded or reported, cited back to the paper it came from.",
  },
  {
    label: "Compare across papers",
    detail: "Methods, populations, findings and gaps across the whole repository.",
  },
  {
    label: "Chart what it counts",
    detail: "Papers by year, topic frequency and other counts it can compute.",
  },
  {
    label: "Answer in Thai or English",
    detail: "Either language, with paper titles kept exactly as stored so they stay checkable.",
  },
];

/**
 * What the assistant refuses, and why.
 *
 * Stated up front rather than discovered by asking. Every entry here matches a
 * refusal the server actually makes; a claim of a limit that is not enforced is
 * as misleading as a limit that is not disclosed.
 */
export const LIMITS: Capability[] = [
  {
    label: "Citation counts and impact",
    detail: "Not stored. The repository holds the papers, not bibliometric data about them.",
  },
  {
    label: "Anything in the future",
    detail: "Predictions about what will be published or cited are guesses, so it refuses.",
  },
  {
    label: "Papers not in the repository",
    detail: "It answers from what was uploaded and analysed, and says so when a paper is absent.",
  },
  {
    label: "Full text of a paper it could not read",
    detail: "A file that failed analysis is excluded, and the coverage line says how many.",
  },
];

/**
 * Whether a suggested follow-up is one the assistant would refuse.
 *
 * Suggesting a question and then refusing it wastes the reader's time and makes
 * the assistant look inconsistent, so suggestions are filtered through the same
 * patterns the server uses to detect an unanswerable request.
 */
export function isRefusedQuestion(question: string): boolean {
  return detectUnavailableMetric(question) !== null;
}

/** Facts a repository of paper text simply does not contain. */
export type UnavailableMetric =
  | "citation_counts"
  | "author_metrics"
  | "venue_metrics"
  | "future_prediction"
  | "usage_metrics";

/**
 * Requests the assistant refuses, because the repository holds paper text and
 * nothing about how those papers were received.
 *
 * These moved here from beside the answer-building code so the page can tell a
 * reader what will be refused, and so a suggested follow-up can be checked
 * against the same patterns the server applies. A second copy would drift, and
 * the failure would be the page offering a question the server then declines -
 * which is exactly what this phase's criteria forbid.
 */
const UNAVAILABLE_METRIC_PATTERNS: Array<[UnavailableMetric, RegExp]> = [
  // "how many citations", "times cited" - not "the citations in this paper",
  // which means its reference list.
  ["citation_counts", /\b(?:how many|number of|count of|total)\s+citations\b|\bcitation count\b|\btimes cited\b|\bcited by\b/i],
  ["author_metrics", /\bh-?index\b|\bi10-?index\b|\bauthor (?:ranking|impact|metrics)\b/i],
  ["venue_metrics", /\bimpact factor\b|\bjournal (?:rank|ranking|quartile)\b|\bscimago\b|\bq[1-4] journal\b/i],
  ["future_prediction", /\b(?:will|going to|expect(?:ed)?|predict|forecast|projection)\b[^.?!]{0,60}\b(?:cite|citations|impact|popular|influence)\b/i],
  ["usage_metrics", /\b(?:downloads?|altmetric|readership|views|reads)\b\s*(?:count|number|statistics|stats)?\b/i],
];

export function detectUnavailableMetric(prompt: string): UnavailableMetric | null {
  for (const [metric, pattern] of UNAVAILABLE_METRIC_PATTERNS) {
    if (pattern.test(prompt)) return metric;
  }
  return null;
}

/**
 * Follow-up questions derived from what an answer did not cover.
 *
 * The answer already reports its own gaps - the coverage line, the limitations,
 * and the evidence needs the retrieval could not meet. Those are the questions
 * a reader is about to ask anyway, so offering them saves the retyping.
 */
export function followUpSuggestions(input: {
  limitations?: string[];
  missingEvidenceNeeds?: string[];
  citedPaperCount?: number;
  scopedPaperCount?: number;
}): string[] {
  const suggestions: string[] = [];

  for (const need of input.missingEvidenceNeeds ?? []) {
    const trimmed = need.trim().replace(/\.$/, "");
    if (trimmed.length < 8) continue;
    suggestions.push(`What do the papers say about ${trimmed.toLowerCase()}?`);
  }

  const cited = input.citedPaperCount ?? 0;
  const scoped = input.scopedPaperCount ?? 0;
  if (cited > 0 && scoped > cited) {
    suggestions.push(`What do the other ${scoped - cited} papers say about this?`);
  }

  if ((input.limitations ?? []).some((limit) => /coverage|not exhaustive|relevance search/i.test(limit))) {
    suggestions.push("Answer this again across every paper, not only the most relevant.");
  }

  return [...new Set(suggestions)]
    .filter((suggestion) => !isRefusedQuestion(suggestion))
    .slice(0, 3);
}

/** One line stating what a question will search, before it is sent. */
export function scopeDescription(scopeLabel: string, eligiblePaperCount: number | null): string {
  if (eligiblePaperCount === null) return `Searching ${scopeLabel}`;
  if (eligiblePaperCount === 0) {
    return `${scopeLabel} has no analysed papers yet`;
  }
  return `Searching ${eligiblePaperCount} analysed paper${eligiblePaperCount === 1 ? "" : "s"} in ${scopeLabel}`;
}

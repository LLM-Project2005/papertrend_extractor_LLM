/*
 * Example questions for "Ask about these papers" that these papers can answer
 * (2026-10-09 review: "have AI generate the example questions so they work
 * 100% with the papers in there"). The examples used to be three fixed
 * questions, such as one about assessment papers, shown whatever a repository
 * held.
 *
 * Each example is a query first and words second. Candidate views are built
 * from the values these papers actually have, and each is run by code here;
 * only those that draw a real chart are kept. A model then words them as a
 * researcher would ask; a wording that drops a value the view is about falls
 * back to a plain template. Choosing an example runs its query directly, so
 * it can never come back unanswerable.
 */
import type { InsightCorpus } from "@/lib/insights/corpus";
import { askVocabulary, runAskQuery, type AskDimension, type AskQuery } from "@/lib/insights/ask";
import type { Insight } from "@/lib/insights/types";

export interface SuggestedQuestion {
  question: string;
  query: AskQuery;
}

const PLURAL: Record<AskDimension, string> = {
  theme: "themes",
  method: "methods",
  category: "research areas",
  contribution: "kinds of contribution",
  study_type: "kinds of study",
  aim: "aims",
  year: "years",
};

const NOUN: Record<AskDimension, string> = {
  theme: "theme",
  method: "method",
  category: "research area",
  contribution: "contribution",
  study_type: "kind of study",
  aim: "aim",
  year: "year",
};

/** The plain wording of a view, used when no model wording can be trusted. */
export function templateQuestion(query: AskQuery): string {
  const focus = query.focus?.values[0];
  if (query.measure === "change") {
    return focus ? `How have the ${PLURAL[query.rows]} of papers on ${focus} changed over time?` : `Which ${PLURAL[query.rows]} have grown or faded over time?`;
  }
  if (query.rows === "year") return focus ? `How many papers on ${focus} appeared each year?` : "How many papers were published each year?";
  if (query.columns) return `Which ${PLURAL[query.rows]} go with which ${NOUN[query.columns]}?`;
  if (focus) return `Which ${PLURAL[query.rows]} do the papers on ${focus} have?`;
  return `Which ${PLURAL[query.rows]} are most common in these papers?`;
}

/** Whether a computed view says something: at least two rows (and two columns for a cross). */
function drawsSomething(insight: Insight): boolean {
  const chart = insight.chart;
  switch (chart.kind) {
    case "bars":
      return chart.rows.filter((row) => row.value > 0).length >= 2;
    case "matrix":
      return chart.rows.length >= 2 && chart.cols.length >= 2;
    case "compare":
    case "pairs":
    case "lifecycles":
    case "list":
      return chart.rows.length >= 2;
  }
}

/**
 * Views these papers can answer, most useful first, each checked by running
 * it. At most `limit`.
 */
export function answerableQueries(corpus: InsightCorpus, limit = 4): AskQuery[] {
  const vocabulary = askVocabulary(corpus, 6);
  const has = (dimension: AskDimension) =>
    dimension === "year" ? corpus.papers.filter((paper) => paper.year !== null).length >= 2 : vocabulary[dimension].length >= 2;
  const [firstTheme, secondTheme] = vocabulary.theme;
  const base = { answerable: true, title: "", measure: "papers" as const, columns: null, focus: null };
  const candidates: AskQuery[] = [
    { ...base, rows: "method", columns: "theme" },
    { ...base, measure: "change", rows: "theme" },
    ...(firstTheme ? [{ ...base, rows: "method" as const, focus: { dimension: "theme" as const, values: [firstTheme] } }] : []),
    { ...base, rows: "contribution" },
    ...(secondTheme ? [{ ...base, rows: "aim" as const, focus: { dimension: "theme" as const, values: [secondTheme] } }] : []),
    ...(corpus.classificationEnabled ? [{ ...base, rows: "category" as const, columns: "year" as const }] : []),
    { ...base, rows: "study_type" },
    { ...base, rows: "year" },
  ];
  const kept: AskQuery[] = [];
  for (const candidate of candidates) {
    if (kept.length >= limit) break;
    if (!has(candidate.rows) || (candidate.columns && !has(candidate.columns))) continue;
    const query = { ...candidate, title: templateQuestion(candidate) };
    const result = runAskQuery(corpus, query);
    if ("insight" in result && drawsSomething(result.insight)) kept.push(query);
  }
  return kept;
}

/** The request that asks a model to word the views; the views, not the model, decide what is asked. */
export function wordingMessages(queries: AskQuery[], scopeLabel: string) {
  const views = queries.map((query, index) => ({
    n: index + 1,
    counts: query.measure === "change" ? "how the share of papers changed from earlier to later years" : "papers",
    by: query.rows,
    against: query.columns ?? null,
    only_papers_with: query.focus ? { [query.focus.dimension]: query.focus.values } : null,
    plain_wording: query.title,
  }));
  return [
    {
      role: "system" as const,
      content:
        "You word example questions for researchers exploring a set of academic papers. Each view below is already computed; write one short, natural question (at most 14 words) that asks exactly for that view, as a curious researcher would. Keep every named value (in only_papers_with) word for word. Do not add topics, numbers or claims. Reply with JSON {\"questions\": [\"...\"]}, one per view, in order.",
    },
    { role: "user" as const, content: JSON.stringify({ papers: scopeLabel, views }) },
  ];
}

/** Takes the model's wordings where they are safe, the template otherwise. */
export function applyWordings(queries: AskQuery[], raw: unknown): SuggestedQuestion[] {
  const items = raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions)
    ? ((raw as { questions: unknown[] }).questions)
    : [];
  return queries.map((query, index) => {
    const worded = typeof items[index] === "string" ? items[index].replace(/\s+/g, " ").trim() : "";
    const keepsValues = (query.focus?.values ?? []).every((value) => worded.toLowerCase().includes(value.toLowerCase()));
    const usable = worded.length >= 8 && worded.length <= 140 && keepsValues && !/\d/.test(worded.replace(/\d{4}/g, ""));
    return { question: usable ? worded : query.title, query };
  });
}

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
  /** Names the view, so the page can ask for ones it has not shown yet. */
  key: string;
}

/** A view's identity, whatever it is called: what is counted, against what, among which papers. */
export function queryKey(query: AskQuery): string {
  return JSON.stringify([
    query.measure,
    query.rows,
    query.columns ?? null,
    query.focus ? [query.focus.dimension, [...query.focus.values].sort()] : null,
  ]);
}

/** "papers on mangroves", "papers using interviews", "papers in Assessment". */
function amongPapers(focus: NonNullable<AskQuery["focus"]>): string {
  const value = focus.values[0];
  if (focus.dimension === "method") return `papers using ${value}`;
  if (focus.dimension === "category") return `papers in ${value}`;
  if (focus.dimension === "study_type") return `${value} papers`;
  return `papers on ${value}`;
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
  const among = query.focus ? amongPapers(query.focus) : null;
  if (query.measure === "change") {
    return among ? `How have the ${PLURAL[query.rows]} of ${among} changed over time?` : `Which ${PLURAL[query.rows]} have grown or faded over time?`;
  }
  if (query.rows === "year") return among ? `How many ${among} appeared each year?` : "How many papers were published each year?";
  if (query.columns === "year") return `How are the ${PLURAL[query.rows]} spread across the years${among ? ` among ${among}` : ""}?`;
  if (query.columns) return `Which ${PLURAL[query.rows]} go with which ${NOUN[query.columns]}${among ? ` among ${among}` : ""}?`;
  if (among) return `Which ${PLURAL[query.rows]} do the ${among} have?`;
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
 * Every view worth suggesting for these papers, most useful first, before any
 * is checked. Built from the values the papers have, so a repository on coastal
 * flooding is offered its own themes and methods, and long enough that a reader
 * who keeps asking for new questions gets new ones (2026-10-10: "the question
 * should regenerate every time ... and it has to be a new one").
 */
function candidateQueries(corpus: InsightCorpus): AskQuery[] {
  const vocabulary = askVocabulary(corpus, 6);
  const base = { answerable: true, title: "", measure: "papers" as const, columns: null, focus: null };
  const classified = corpus.classificationEnabled;
  const view = (rows: AskDimension, more: Partial<AskQuery> = {}): AskQuery => ({ ...base, rows, ...more });
  const among = (dimension: AskDimension, value: string) => ({ focus: { dimension, values: [value] } });
  const [firstTheme, secondTheme] = vocabulary.theme;

  const candidates: AskQuery[] = [
    // The broad views first: what the papers are and how they go together.
    view("method", { columns: "theme" }),
    view("theme", { measure: "change" }),
    ...(firstTheme ? [view("method", among("theme", firstTheme))] : []),
    view("contribution"),
    ...(secondTheme ? [view("aim", among("theme", secondTheme))] : []),
    ...(classified ? [view("category", { columns: "year" })] : []),
    view("study_type"),
    view("year"),
    // Crossings and changes.
    view("contribution", { columns: "theme" }),
    view("study_type", { columns: "method" }),
    view("aim", { columns: "theme" }),
    view("method", { measure: "change" }),
    view("theme", { columns: "year" }),
    view("contribution", { columns: "method" }),
    view("study_type", { columns: "year" }),
    view("contribution", { measure: "change" }),
    ...(classified ? [view("theme", { columns: "category" }), view("method", { columns: "category" }), view("category", { measure: "change" })] : []),
    view("method"),
    view("aim"),
  ];
  // Then a closer look at each common theme, method and research area.
  vocabulary.theme.slice(0, 5).forEach((theme) => {
    candidates.push(
      view("method", among("theme", theme)),
      view("year", among("theme", theme)),
      view("contribution", among("theme", theme)),
      view("aim", among("theme", theme)),
      view("study_type", among("theme", theme))
    );
  });
  vocabulary.method.slice(0, 4).forEach((method) => {
    candidates.push(view("theme", among("method", method)), view("year", among("method", method)), view("contribution", among("method", method)));
  });
  if (classified) {
    vocabulary.category.slice(0, 4).forEach((category) => {
      candidates.push(view("theme", among("category", category)), view("method", among("category", category)));
    });
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = queryKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Views these papers can answer, most useful first, each checked by running
 * it. At most `limit`, none of those in `exclude` (keys from queryKey).
 */
export function answerableQueries(corpus: InsightCorpus, limit = 4, exclude: ReadonlySet<string> = new Set()): AskQuery[] {
  const vocabulary = askVocabulary(corpus, 6);
  const has = (dimension: AskDimension) =>
    dimension === "year" ? corpus.papers.filter((paper) => paper.year !== null).length >= 2 : vocabulary[dimension].length >= 2;
  const kept: AskQuery[] = [];
  for (const candidate of candidateQueries(corpus)) {
    if (kept.length >= limit) break;
    if (exclude.has(queryKey(candidate))) continue;
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
    return { question: usable ? worded : query.title, query, key: queryKey(query) };
  });
}

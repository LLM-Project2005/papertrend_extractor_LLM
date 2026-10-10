/*
 * Chart mode after the test account's chats of 2026-10-09: every section a
 * paper prints (not the four the analysis stores), the paper a question names
 * (not the whole repository), and a question that asks for an explanation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildRepositoryTermCounts } from "../src/lib/repository-text";
import { splitPaperSections } from "../src/lib/paper-sections";
import {
  asksForExplanation,
  chartModeOperations,
  namedPaperContext,
  papersNamedInQuestion,
  paperSectionCounts,
  wordCountResult,
} from "../src/lib/repository-chat";
import type {
  PaperContentSource,
  RepositoryContext,
  RepositoryDataChart,
  RepositoryExecutionPlan,
  RepositoryPaper,
  RepositoryPromptPlan,
} from "../src/lib/repository-chat";

function paper(overrides: Partial<RepositoryPaper> & { paperId: string; title: string }): RepositoryPaper {
  const content = overrides.content ?? "";
  const index = buildRepositoryTermCounts(content);
  return {
    runId: `run-${overrides.paperId}`,
    folderId: "folder-1",
    year: "2022",
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content,
    contentHash: `hash-${overrides.paperId}`,
    contentSource: "full_text" as PaperContentSource,
    totalWords: index.totalWords,
    termCounts: index.termCounts,
    topics: new Map(),
    keywords: new Map(),
    ...overrides,
  };
}

function context(papers: RepositoryPaper[]): RepositoryContext {
  return {
    ownerUserId: "owner-1",
    projectId: "project-1",
    folderId: null,
    selectedRunIds: [],
    knowledgeScope: { kind: "project", projectId: "project-1" },
    scopeSnapshot: { kind: "project", label: "Test", projectId: "project-1", projectName: "Test", folderId: null, folderName: null, selectedRunCount: 0, eligiblePaperCount: papers.length },
    projects: [{ id: "project-1", name: "Test" }],
    scopeLabel: "Test repository",
    versionHash: "v",
    summaryMarkdown: "",
    papers,
    topicCounts: [],
    keywordCounts: [],
    totalWords: 0,
    runStats: { total: papers.length, succeeded: papers.length, queued: 0, processing: 0, failed: 0, canceled: 0, other: 0 },
  } as RepositoryContext;
}

function plan(overrides: Partial<RepositoryPromptPlan> = {}): RepositoryPromptPlan {
  return {
    intent: "word_count",
    refinedQuestion: "count the words in each section",
    terms: [],
    retrievalQueries: [],
    evidenceNeeds: [],
    answerLanguage: "English",
    retrievalMode: "exhaustive",
    needsChart: false,
    chartType: "bar",
    reason: "",
    confidence: "high",
    source: "llm",
    ...overrides,
  } as RepositoryPromptPlan;
}

function execution(operations: RepositoryExecutionPlan["operations"]): RepositoryExecutionPlan {
  return {
    operation: operations[0],
    operations,
    scopeMode: "complete",
    refinedQuestion: "",
    terms: [],
    retrievalQueries: [],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "prose",
    chartType: "bar",
    reason: "",
    confidence: "high",
    source: "llm",
  };
}

// The shape the OCR step stores: a running header, a front-matter table, marked-up headings.
const BRANDING_TEXT = [
  "FEU ACADEMIC REVIEW",
  "Thailand's Exported Food Product Brand Naming:",
  "A Focus on Semantics and Pragmatics",
  "| Received 03/02/2012 | **Abstract** |",
  "Brand names carry meaning beyond the product they name and this study asks how.",
  "**Introduction**",
  "Exporters name products for buyers who read English as a foreign language.",
  "They choose words with care because a name travels further than an advertisement.",
  "Methodology",
  "### 1. Population and Sample",
  "We collected 175 brand names from five categories of exported food.",
  "| Results | A Semantic and Pragmatic Guideline | I |",
  "## Results and Discussion",
  "Most names used descriptive strategies, and many flouted a Gricean maxim on purpose.",
  "Buyers read the intended meaning in most cases.",
  "### Conclusion",
  "Meaning and context together make a name persuasive.",
  "**References**",
  "Grice, H. P. (1975). Logic and conversation.",
].join("\n");

test("a paper's sections are read from the headings it prints, in reading order", () => {
  const sections = splitPaperSections(BRANDING_TEXT);
  assert.ok(sections);
  assert.deepEqual(
    sections.map((section) => section.key),
    ["front_matter", "abstract", "introduction", "methods", "results_discussion", "conclusion", "references"],
    "the 'Results' cell of a table is not a heading; a plain 'Methodology' line is"
  );
  assert.match(sections[2].text, /^Exporters name products/);
  assert.match(sections[3].text, /175 brand names/, "a numbered sub-heading stays inside its section");
});

test("a heading out of reading order does not cut the paper short", () => {
  const thesis = [
    "Enhancing Learner Autonomy",
    "ACKNOWLEDGEMENTS",
    "I thank my advisor.",
    "**INTRODUCTION**",
    "Autonomy matters.",
    "**LITERATURE REVIEW**",
    "Much has been written.",
    "**Conclusion**",
    "A stray heading quoted from another study.",
    "**METHODOLOGY**",
    "Forty learners took part.",
    "**FINDINGS AND DISCUSSION**",
    "Learners grew more independent.",
    "**REFERENCES**",
    "Benson, P. (2011).",
  ].join("\n");
  const keys = splitPaperSections(thesis)?.map((section) => section.key);
  assert.deepEqual(keys, ["front_matter", "introduction", "literature_review", "methods", "results_discussion", "references"]);
});

test("too few headings fall back to the stored parts", () => {
  assert.equal(splitPaperSections("Just one paragraph of text with no headings at all."), null);
  const counts = paperSectionCounts(paper({ paperId: "9", title: "No headings", content: "Plain text only.", abstract: "An abstract here." }));
  assert.equal(counts.source, "stored");
  assert.deepEqual(counts.parts.map((part) => part.key), ["abstract", "methods", "results", "conclusion"]);
});

test("words in each section count every printed section and chart them in order", () => {
  const branding = paper({ paperId: "1", title: "Thailand's Exported Food Product Brand Naming: A Focus on Semantics and Pragmatics", content: BRANDING_TEXT });
  const result = wordCountResult(context([branding]), plan());
  assert.match(result.answer, /\| Introduction \| \d+ \| \d+% \|/);
  assert.match(result.answer, /\| References \| \d+ \| \d+% \|/);
  assert.match(result.answer, /Sections follow the headings printed in the paper/);
  const chart = result.charts[0] as RepositoryDataChart;
  assert.deepEqual(chart.data.map((row) => row.label), ["Title and authors", "Abstract", "Introduction", "Methods", "Results and discussion", "Conclusion", "References"]);
  assert.equal(chart.data[2].words, buildRepositoryTermCounts("Exporters name products for buyers who read English as a foreign language.\nThey choose words with care because a name travels further than an advertisement.").totalWords);
});

test("several papers share one table and, when asked, one stacked chart", () => {
  const branding = paper({ paperId: "1", title: "Thailand's Exported Food Product Brand Naming", content: BRANDING_TEXT });
  const other = paper({
    paperId: "2",
    title: "Coffee names in Chiang Mai",
    content: ["Coffee names in Chiang Mai", "**Abstract**", "Short.", "**Method**", "Twenty cafes.", "**Results**", "Most used Thai words.", "**Discussion**", "Locals liked it."].join("\n"),
  });
  const copy = { ...branding, paperId: "3", runId: "run-3" };
  const result = wordCountResult(context([branding, other, copy]), plan({ needsChart: true }));
  assert.match(result.answer, /\| Paper \| Title and authors \| Abstract \| Introduction \| Methods \| Results and discussion \| Results \| Discussion \| Conclusion \| References \| Whole paper \|/);
  assert.match(result.answer, /\| Coffee names in Chiang Mai \| [\d]+ \| [\d]+ \| – \|/, "a section a paper lacks shows a dash");
  assert.match(result.answer, /One paper was uploaded twice and is counted once\./);
  const chart = result.charts[0] as RepositoryDataChart;
  assert.equal(chart.stacked, true);
  assert.equal(chart.data.length, 2);
  assert.equal(wordCountResult(context([branding, other]), plan()).charts.length, 0, "no chart unless one is asked for");
});

test("a question that names a paper is counted in that paper alone", () => {
  const branding = paper({ paperId: "1", title: "Thailand's Exported Food Product Brand Naming: A Focus on Semantics and Pragmatics", content: BRANDING_TEXT });
  const others = [
    paper({ paperId: "2", title: "L2 Production of English Word Stress by L1 Thai Learners" }),
    paper({ paperId: "3", title: "English Plosive Consonants Produced by Thai Speakers" }),
  ];
  const question = "from this paper, Thailand’s Exported Food Product Brand Naming: A Focus on Semantics and Pragmatics (2012)\n\ncount how many words in each section and show in a bar chart";
  assert.deepEqual(papersNamedInQuestion(question, [branding, ...others]).map((item) => item.paperId), ["1"]);
  assert.deepEqual(papersNamedInQuestion("which papers study semantics of food brand names?", [branding, ...others]), [], "a subject is not a title");

  const narrowed = namedPaperContext(question, execution(["analyze_text", "visualize"]), context([branding, ...others]));
  assert.ok(narrowed);
  assert.deepEqual(narrowed.papers.map((item) => item.paperId), ["1"]);
  assert.match(narrowed.scopeLabel, /^“Thailand's Exported Food Product Brand Naming/);
  assert.equal(
    namedPaperContext("what does Thailand's Exported Food Product Brand Naming: A Focus on Semantics and Pragmatics find, compared with the others?", execution(["search_evidence"]), context([branding, ...others])),
    null,
    "a question answered from the text keeps its scope"
  );
});

test("Chart mode answers a question that asks for an explanation, then charts", () => {
  assert.equal(asksForExplanation("explain this paper"), true);
  assert.equal(asksForExplanation("what did they find about pronunciation?"), true);
  assert.equal(asksForExplanation("chart this paper"), false);
  assert.equal(asksForExplanation("count the words in each section"), false);
  assert.deepEqual(chartModeOperations(["search_evidence", "visualize"], false, "explain this paper"), ["search_evidence", "visualize"]);
  assert.deepEqual(chartModeOperations(["aggregate_corpus", "visualize"], false, "papers per year"), ["visualize"]);
});

test("the word-count shortcut draws the chart the planner added", () => {
  const source = readFileSync(new URL("../src/lib/repository-chat.ts", import.meta.url), "utf8");
  const shortcut = source.slice(source.indexOf("if (requestsTotalWordCount(input.prompt) && context.papers.length > 0)"));
  assert.match(shortcut.slice(0, 900), /needsChart: plan\.needsChart \|\| Boolean\(execution\?\.operations\?\.includes\("visualize"\)\) \|\| promptRequestsChart\(input\.prompt, input\.forceChart\)/);
});

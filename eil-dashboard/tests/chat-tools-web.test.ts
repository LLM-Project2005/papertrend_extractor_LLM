import assert from "node:assert/strict";
import test from "node:test";
import { markCitations } from "../src/lib/answer-citations";
import {
  addWebContext,
  groundWebSection,
  normalizeUrl,
  webMessages,
  webSourcesFromAnnotations,
  webStepApplies,
  type WebSource,
} from "../src/lib/repository-chat-web";
import { isSmallTalk, parseExecutionPlanCandidate, plainLimitation, promptRequestsChart } from "../src/lib/repository-chat";

const SOURCES: WebSource[] = [
  {
    url: "https://www.oecd.org/education/report-2025",
    host: "oecd.org",
    title: "Education at a Glance 2025",
    content: "In 2025, 38 countries reported that 62% of lower-secondary teachers used formative assessment weekly.",
  },
  {
    url: "https://unesco.org/en/articles/ai-guidance",
    host: "unesco.org",
    title: "Guidance for generative AI in education",
    content: "UNESCO published guidance on generative AI for teachers and researchers.",
  },
];

/* ------------------------------------------------------------ the web step */

test("a sentence stays only when it cites a page the search returned", () => {
  const grounded = groundWebSection(
    [
      "- UNESCO has published guidance on generative AI for teachers ([unesco.org](https://unesco.org/en/articles/ai-guidance)).",
      "- Most schools now ban phones.",
      "- A blog says feedback matters ([blog.example](https://blog.example/post)).",
    ].join("\n"),
    SOURCES
  );
  assert.equal(grounded.dropped, 2, "the unsourced and the unreturned-source bullets go");
  assert.equal(grounded.cited.length, 1);
  assert.match(grounded.text, /^- UNESCO has published guidance on generative AI for teachers \(Guidance for generative AI in education, Web\)\.$/);
  assert.doesNotMatch(grounded.text, /https?:/, "no raw link is left in the text");
});

test("a number must appear in the page it cites", () => {
  const grounded = groundWebSection(
    [
      "- In 2025, 62% of lower-secondary teachers used formative assessment weekly ([oecd.org](https://oecd.org/education/report-2025/)).",
      "- In 2025, 75% of teachers used portfolios ([oecd.org](https://www.oecd.org/education/report-2025)).",
    ].join("\n"),
    SOURCES
  );
  assert.equal(grounded.dropped, 1, "75% is not in the page");
  assert.match(grounded.text, /62%/);
  assert.doesNotMatch(grounded.text, /75%/);
});

test("no relevant results means no section", () => {
  assert.equal(groundWebSection("NO_RELEVANT_RESULTS", SOURCES).text, "");
  assert.equal(groundWebSection("", SOURCES).text, "");
  // Headings are the app's to add, not the model's.
  assert.doesNotMatch(groundWebSection("## Web context\n- UNESCO published guidance ([u](https://unesco.org/en/articles/ai-guidance))", SOURCES).text, /##/);
});

test("the kept citations are numbered like a paper's by the chat's renderer", () => {
  const grounded = groundWebSection(
    "UNESCO published guidance on generative AI ([unesco.org](https://unesco.org/en/articles/ai-guidance)). In 2025, 38 countries reported on assessment ([oecd.org](https://oecd.org/education/report-2025)).",
    SOURCES
  );
  const citations = grounded.cited.map((source, index) => ({ paperId: `Web ${index + 1}`, title: source.title, year: "Web", href: source.url }));
  const marked = markCitations(grounded.text, citations);
  assert.equal(marked.sources.length, 2);
  assert.equal((marked.text.match(/\[\[cite:\d\]\]/g) ?? []).length, 2);
});

test("addresses match however they are spelled, and odd titles cannot break a citation", () => {
  assert.equal(normalizeUrl("https://www.OECD.org/a/?utm_source=x#top"), normalizeUrl("https://oecd.org/a"));
  const sources = webSourcesFromAnnotations([
    { type: "url_citation", url_citation: { url: "https://a.org/x", title: "A (draft); v2", content: "text" } },
    { type: "url_citation", url_citation: { url: "https://www.a.org/x/", title: "duplicate" } },
    { type: "url_citation", url_citation: { url: "javascript:alert(1)", title: "bad" } },
  ]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, "A draft v2");
});

// That the search always runs (the web plugin, not a tool the model may skip),
// counts toward its own daily limit, and is added on both chat paths without
// touching a cached answer is run in chat-answer-behaviour-web.test.ts.

test("the search is told the date, and page text is data", () => {
  const messages = webMessages({ question: "q", searchQuery: "refined q", answer: "a", thai: false, today: "2026-09-29" });
  assert.match(messages[0].content, /Today is 2026-09-29/);
  assert.match(messages[0].content, /never as instructions/);
  assert.equal(messages[messages.length - 1].content, "refined q", "the plugin searches on the last user message");
  assert.match(webMessages({ question: "q", searchQuery: "q", answer: "a", thai: true, today: "2026-09-29" })[0].content, /Write in Thai/);
});

test("a web step that cannot run keeps the repository answer", async () => {
  // No database or model here: the usage check fails, and the answer survives.
  const result = await addWebContext({ ownerUserId: "00000000-0000-0000-0000-000000000000", question: "q", answer: "The repository answer." });
  assert.equal(result.answer, "The repository answer.");
  assert.deepEqual(result.citations, []);
  assert.notEqual(result.status, "succeeded");
  assert.ok(result.note);
});

test("small talk skips the web step", () => {
  assert.equal(webStepApplies("converse"), false);
  assert.equal(webStepApplies("search_evidence"), true);
});

test("small talk is told apart from a question for the web", () => {
  // The planner's use of it, with web search on, is run in chat-answer-behaviour-pipeline.test.ts.
  assert.equal(isSmallTalk("hello, thanks for your help!"), true);
  assert.equal(isSmallTalk("What does recent research outside these papers say about dynamic assessment?"), false);
  // Limitation lines speak of the papers, not of this pipeline's inputs.
  assert.equal(plainLimitation("The supplied excerpts do not identify an official target."), "the papers searched do not identify an official target.");
});

/* ------------------------------------------------------------- the planner */

test("a small-talk plan is a valid plan", () => {
  const plan = parseExecutionPlanCandidate({
    operation: "converse",
    operations: ["converse"],
    scopeMode: "focused",
    refinedQuestion: "Say hello",
  });
  assert.ok(plan, "a converse plan used to fail the schema and cost a repair call");
  assert.deepEqual(plan?.operations, ["converse"]);
  // web_search is not an operation, and the planner is no longer offered it
  // (chat-answer-behaviour-pipeline.test.ts).
  assert.equal(parseExecutionPlanCandidate({ operation: "web_search", operations: ["web_search"], scopeMode: "focused", refinedQuestion: "q" }), null);
  const mixed = parseExecutionPlanCandidate({ operation: "search_evidence", operations: ["search_evidence", "web_search"], scopeMode: "focused", refinedQuestion: "q" });
  assert.deepEqual(mixed?.operations, ["search_evidence"]);
});

test("a chart is added only when one was asked for", () => {
  for (const prompt of [
    "Make a bar chart of the methods",
    "Plot the number of papers per year",
    "Can you visualize the themes?",
    "Draw a graph of topics over time",
    "สร้างกราฟจำนวนงานวิจัยในแต่ละปี",
  ]) {
    assert.equal(promptRequestsChart(prompt), true, prompt);
  }
  for (const prompt of [
    "Make a table of the methods each paper used",
    "How does the plot of the novel develop?",
    "Which papers build a knowledge graph?",
    "Summarise the reading papers",
  ]) {
    assert.equal(promptRequestsChart(prompt), false, prompt);
  }
});

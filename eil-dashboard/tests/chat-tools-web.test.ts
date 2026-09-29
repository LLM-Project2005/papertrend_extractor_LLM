import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { parseExecutionPlanCandidate, promptRequestsChart } from "../src/lib/repository-chat";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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

test("the search always runs, with the date, and page text is data", () => {
  const source = read("src/lib/repository-chat-web.ts");
  assert.match(source, /plugins: \[\{ id: "web", engine: "exa", max_results: MAX_RESULTS \}\]/, "the web plugin searches before the model answers");
  assert.doesNotMatch(source, /toolChoice: "auto"/);
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

test("both chat paths use the checked web step, and small talk skips it", () => {
  assert.equal(webStepApplies("converse"), false);
  assert.equal(webStepApplies("search_evidence"), true);
  const route = read("src/app/api/chat/route.ts");
  assert.match(route, /const web = await addWebContext\(/);
  assert.match(route, /const repositoryCitations = \[\.\.\.\(repositoryResult\.citations as Citation\[\]\)\];/, "a copy, never the cached array");
  const job = read("src/app/api/chat/jobs/process/route.ts");
  assert.match(job, /const web = await addWebContext\(/);
  assert.doesNotMatch(job, /augmentRepositoryAnswerWithWeb/);
  assert.match(job, /return withAiTokenUsageTracking\(async \(usage\) => \{/, "a background answer's tokens are recorded");
  assert.match(job, /await persistAiTokenUsage\(job\.ownerUserId, usage\)/);
});

test("each web search counts toward its own daily limit", () => {
  assert.match(read("src/lib/repository-chat-web.ts"), /assertAndRecordAiUsage\(input\.ownerUserId, "web_search"/);
  assert.match(read("src/lib/security-guards.ts"), /kind === "web_search"\s*\?\s*getAiDailyWebSearchLimit\(\)/);
});

test("a cached answer is handed out as a copy", () => {
  const source = read("src/lib/repository-chat.ts");
  assert.match(source, /citations: structuredClone\(hit\.citations\) as RepositoryCitation\[\]/);
  assert.match(source, /citations: structuredClone\(result\.citations\),/);
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
  // web_search is not an operation; offering it invited a plan the schema dropped.
  const planner = read("src/lib/repository-chat.ts");
  assert.doesNotMatch(planner, /\.\.\.\(input\.allowWeb \? \["web_search"\] : \[\]\)/);
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

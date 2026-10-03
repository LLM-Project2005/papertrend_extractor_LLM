/*
 * How the repository chat writes, checks and shapes an answer, run rather than
 * read (docs/32, long-term health): the markup and shape rules its writers and
 * reviews are given, its fallback, its refusals, its planner's handling of web
 * search, its answer cache, its repository-wide counts and its review
 * outcomes, and the scope route the composer reads. runRepositoryChat and the
 * route run as written against papers in PGlite under the app's role
 * (tests/support/route-harness.ts); only the model answers from a script, by
 * task name (stub-chatscope-openai.ts). Nothing leaves the process.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RepositoryChatInput, RepositoryExecutionPlan } from "../src/lib/repository-chat";
import type { ScriptedModelCall } from "./support/stub-chatscope-openai";
import { emptySections, leadsWithDirectAnswer, renderingIssues } from "../src/lib/answer-rendering";
import { readabilityIssues } from "../src/lib/answer-readability";
import { isRefusedQuestion } from "../src/lib/chat-guidance";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/openai.ts", new URL("./support/stub-chatscope-openai.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const SITE = "https://papertrend.web.app";
/** Raw extracted PDF text, as an abstract often is. */
const RAW_ABSTRACT = "a b s t r a c t Faculty of Education, Chulalongkorn University. Corresponding author.";
const PAPERS = [
  {
    run: "11111111-1111-4111-8111-111111111111",
    title: "Peer feedback in second-language writing",
    year: "2021",
    body: "This study examines peer feedback in writing classes. Students who exchanged peer feedback revised their second drafts more often, and revision quality improved.",
    topics: ["Mixed-Methods Research Design", "Academic Writing"],
  },
  {
    run: "22222222-2222-4222-8222-222222222222",
    title: "Mobile apps for vocabulary learning",
    year: "2022",
    body: "Learners used a mobile app to study vocabulary every day. Retention of new words improved after eight weeks.",
    topics: ["Mixed-Method Research Design", "L2 writing"],
  },
  {
    run: "33333333-3333-4333-8333-333333333333",
    title: "Teacher assessment literacy",
    year: "2023",
    body: "Teachers' assessment literacy was surveyed across schools. Rubric use varied widely between schools.",
    topics: ["Academic writing"],
  },
];
/** A paper whose analysis is still running: neither searched nor counted. */
const UNFINISHED = { run: "44444444-4444-4444-8444-444444444444", title: "An unfinished upload", year: "2024" };

type Reply = (call: ScriptedModelCall) => unknown;

async function repository(options: { themes?: boolean } = {}) {
  const harness = await routeHarness({ APP_ALLOWED_ORIGINS: SITE });
  const owner = await harness.signIn(OWNER);
  const { paperIdFromRunId } = await import("../src/lib/paper-id");
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Language learning', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Studies', '${PROJECT}');
  `);
  for (const paper of [...PAPERS, { ...UNFINISHED, body: "Not yet analysed.", topics: [] }]) {
    const paperId = paperIdFromRunId(paper.run);
    const status = paper === PAPERS.find((known) => known.run === paper.run) ? "succeeded" : "processing";
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload)
       VALUES ($1, $2, $3, 'upload', $4, 'paper.pdf', '{}'::jsonb)`,
      [paper.run, OWNER, FOLDER, status]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [paperId, OWNER, FOLDER, paper.year, paper.title]);
    await harness.db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, body, abstract, ingestion_run_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [paperId, OWNER, FOLDER, paper.body, RAW_ABSTRACT, paper.run]
    );
    for (const [index, topic] of paper.topics.entries()) {
      await harness.db.query(
        `INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword, keyword_frequency) VALUES ($1, $2, $3, $4, $5, 1)`,
        [paperId, OWNER, FOLDER, topic, index === 0 && paper.run !== PAPERS[2].run ? "feedback" : "rubric"]
      );
    }
  }
  if (options.themes) {
    const { THEME_STORE_VERSION } = await import("../src/lib/topic-themes");
    const store = {
      version: THEME_STORE_VERSION,
      themes: [{ name: "Mixed methods", kind: "method" }, { name: "Academic writing", kind: "topic" }],
      assignments: { "mixed-methods research design": 0, "mixed-method research design": 0, "academic writing": 1, "l2 writing": 1 },
      groupedAt: "2026-10-01T00:00:00.000Z", fullGroupingTopics: 4, model: null, pendingSince: null, failedAt: null, failures: 0,
    };
    await harness.db.query(
      `INSERT INTO workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash, payload) VALUES ($1, 'custom', $2, 'themes', $3::jsonb)`,
      [OWNER, `topic-themes:v${THEME_STORE_VERSION}:${PROJECT}`, JSON.stringify(store)]
    );
  }
  const chat = await import("../src/lib/repository-chat");
  (await import("../src/lib/answer-cache")).resetAnswerCache();
  const calls: ScriptedModelCall[] = [];
  let reply: Reply = () => null;
  globalThis.__chatScopeModel = { calls, reply: (call) => reply(call) };
  const ask = (prompt: string, extra: Partial<RepositoryChatInput> = {}) =>
    chat.runRepositoryChat({ ownerUserId: OWNER, prompt, knowledgeScope: { kind: "project", projectId: PROJECT }, projectId: PROJECT, ...extra });
  const ids = PAPERS.map((paper) => paperIdFromRunId(paper.run));
  return {
    ...harness,
    ...chat,
    owner,
    calls,
    ask,
    ids,
    peerFeedback: ids[0],
    script: (next: Reply) => void (reply = next),
    /** Every call of one task, oldest first. */
    task: (name: string) => calls.filter((call) => call.taskName === name),
  };
}

function plan(operation: RepositoryExecutionPlan["operation"], scopeMode: RepositoryExecutionPlan["scopeMode"], refinedQuestion: string): RepositoryExecutionPlan {
  return {
    operation,
    operations: [operation],
    scopeMode,
    refinedQuestion,
    terms: [],
    retrievalQueries: [refinedQuestion],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "prose",
    chartType: "bar",
    reason: "test",
    confidence: "high",
    source: "llm",
  };
}

const text = (call: ScriptedModelCall | undefined) => (call?.messages ?? []).map((message) => message.content).join("\n");
const system = (call: ScriptedModelCall | undefined) => call?.messages.find((message) => message.role === "system")?.content ?? "";
const user = (call: ScriptedModelCall | undefined) => call?.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
const APPROVED = { supported: true, answersIntent: true, completeForRequest: true, languageMatched: true, correctedAnswer: "", confidence: 0.9, reason: "" };
const QUESTION = "What do the papers report about peer feedback?";

/* ------------------------------------------------- markup, shape and fallback */

test("markup the reader cannot see sends a confident answer to the review, and a clean one skips it", async () => {
  const { ask, task, calls, script, peerFeedback } = await repository();
  const focused = plan("search_evidence", "focused", QUESTION);
  const marked = `Peer feedback improved revision quality <b>markedly</b> [Paper ${peerFeedback}].`;
  script((call) => {
    if (call.taskName === "CHAT_SYNTHESIS") return { answer: marked, citedPaperIds: [peerFeedback], confidence: 0.9 };
    if (call.taskName === "CHAT_FAITHFULNESS") return { ...APPROVED, citedPaperIds: [peerFeedback], correctedAnswer: `Peer feedback improved revision quality markedly [Paper ${peerFeedback}].` };
    return null;
  });
  const repaired = await ask(QUESTION, { executionPlan: focused });
  assert.equal(task("CHAT_FAITHFULNESS").length, 1, "the only step that can repair it ran");
  assert.match(user(task("CHAT_FAITHFULNESS")[0]), /remove the HTML; write Markdown only/);
  assert.doesNotMatch(repaired.answer, /<b>/);

  calls.length = 0;
  script((call) =>
    call.taskName === "CHAT_SYNTHESIS"
      ? { answer: `Peer feedback improved revision quality [Paper ${peerFeedback}].`, citedPaperIds: [peerFeedback], confidence: 0.9 }
      : null
  );
  const clean = await ask(`${QUESTION} `, { executionPlan: focused });
  assert.equal(task("CHAT_FAITHFULNESS").length, 0, "a clean, confident, cited answer is not reviewed");
  assert.equal(clean.diagnostics.faithfulnessChecked, false);
});

test("an answer in several parts never stacks a heading on a heading", async () => {
  const { ask, script, peerFeedback } = await repository();
  const twoParts = { ...plan("list_documents", "focused", QUESTION), operations: ["list_documents", "search_evidence"] as RepositoryExecutionPlan["operations"] };
  const answerWith = (answer: string) =>
    script((call) => (call.taskName === "CHAT_SYNTHESIS" ? { answer, citedPaperIds: [peerFeedback], confidence: 0.9 } : null));

  // A part that opens with its own heading is not given a second one.
  answerWith(`## Direct answer\n\nPeer feedback improved revision quality [Paper ${peerFeedback}].`);
  const headed = await ask(QUESTION, { executionPlan: twoParts });
  assert.deepEqual(emptySections(headed.answer), [], headed.answer);
  assert.match(headed.answer, /^## Papers in Language learning repository/);
  assert.match(headed.answer, /\n## Direct answer\n\nPeer feedback improved revision quality/);
  assert.doesNotMatch(headed.answer, /## Evidence answer/);

  // A part without one is labelled, so the two parts can be told apart.
  answerWith(`Peer feedback improved revision quality [Paper ${peerFeedback}].`);
  const unheaded = await ask(`${QUESTION} `, { executionPlan: twoParts });
  assert.match(unheaded.answer, /\n## Evidence answer\n\nPeer feedback improved revision quality/);
  assert.deepEqual(emptySections(unheaded.answer), []);
});

test("when the answer cannot be written, the reader gets a short readable fallback, not the papers' raw text", async () => {
  // A judge scored the old fallback 3.0 readable and 2.0 direct: it appended
  // each paper's raw extracted abstract, a wall of PDF fragments.
  const { ask, task } = await repository();
  const result = await ask(QUESTION, { executionPlan: plan("search_evidence", "focused", QUESTION) });
  assert.equal(task("CHAT_SYNTHESIS").length, 2, "the answer was attempted twice");
  assert.match(result.answer, /^\*\*I could not finish this answer\.\*\* .*Please ask again\./);
  assert.match(result.answer, /- \*\*Peer feedback in second-language writing\*\* \(2021\)/);
  assert.ok(!result.answer.includes("a b s t r a c t"), "no raw abstract text reaches the reader");
  assert.ok(!result.answer.includes("Faculty of Education"));
  assert.deepEqual(renderingIssues(result.answer), []);
  assert.equal(leadsWithDirectAnswer(result.answer).ok, true);
});

test("the answer's writer and its review are told which markdown renders, and that a format the reader names comes first", async () => {
  const { ask, task, script, peerFeedback } = await repository();
  script((call) => {
    if (call.taskName === "CHAT_SYNTHESIS") return { answer: `Peer feedback improved revision quality [Paper ${peerFeedback}].`, citedPaperIds: [peerFeedback], confidence: 0.6 };
    if (call.taskName === "CHAT_FAITHFULNESS") return { ...APPROVED, citedPaperIds: [peerFeedback] };
    return null;
  });
  await ask(QUESTION, { executionPlan: plan("search_evidence", "focused", QUESTION) });
  for (const name of ["CHAT_SYNTHESIS", "CHAT_FAITHFULNESS"]) {
    const rules = system(task(name)[0]);
    assert.match(rules, /Images, horizontal rules, indented sub-bullets, checkboxes and HTML are not displayed/, name);
    assert.match(rules, /Never put a heading directly under another heading/, name);
    // The override has to come before the rules it overrides, or it reads as an exception to nothing.
    const override = rules.indexOf("If the request names a format or a length");
    const headings = rules.indexOf("Use a descriptive heading for each distinct part");
    assert.ok(override >= 0 && headings > override, `${name}: the override must precede what it overrides`);
    assert.match(rules, /It overrides every rule below/, name);
  }
});

test("a shape the reader names reaches both answer writers and both reviews, and the reviews stop asking for headings", async () => {
  // Asked for one paragraph, the review used to rewrite the answer back into sections.
  const { ask, task, calls, script, peerFeedback } = await repository();
  const onePara = `${"Peer feedback led students to revise their second drafts more often and improved revision quality. ".repeat(10)}[Paper ${peerFeedback}]`;
  const longParagraph = readabilityIssues(onePara).find((issue) => issue.kind === "long_paragraph")!.detail;
  const noStructure = readabilityIssues(onePara).find((issue) => issue.kind === "no_structure")!.detail;
  script((call) => {
    if (call.taskName === "CHAT_SYNTHESIS") return { answer: onePara, citedPaperIds: [peerFeedback], confidence: 0.9 };
    if (call.taskName === "CHAT_CORPUS_REDUCE") return onePara;
    if (call.taskName === "CHAT_FAITHFULNESS") return { ...APPROVED, citedPaperIds: [peerFeedback] };
    return null;
  });
  const shaped = "Summarise what the papers report about peer feedback in one paragraph.";
  const unshaped = "Summarise what the papers report about peer feedback.";
  const constraint = "The reader asked for ONE paragraph.";
  const paths: Array<[string, (prompt: string) => RepositoryExecutionPlan]> = [
    ["CHAT_SYNTHESIS", (prompt) => plan("search_evidence", "focused", prompt)],
    ["CHAT_CORPUS_REDUCE", (prompt) => plan("aggregate_corpus", "complete", prompt)],
  ];
  for (const [writer, planFor] of paths) {
    calls.length = 0;
    await ask(shaped, { executionPlan: planFor(shaped) });
    assert.ok(user(task(writer)[0]).includes(constraint), `${writer} is told the shape`);
    const review = user(task("CHAT_FAITHFULNESS")[0]);
    assert.ok(review.includes(constraint), `${writer}: the review is told the shape`);
    assert.ok(!review.includes(longParagraph) && !review.includes(noStructure), `${writer}: the review is not asked to break up the one paragraph`);

    calls.length = 0;
    await ask(unshaped, { executionPlan: planFor(unshaped) });
    assert.ok(!user(task(writer)[0]).includes(constraint), `${writer}: no shape was named`);
    const unshapedReview = user(task("CHAT_FAITHFULNESS")[0]);
    assert.ok(unshapedReview.includes(longParagraph) && unshapedReview.includes(noStructure), `${writer}: without a named shape the same answer is sent back to be broken up`);
  }
});

/* ------------------------------------------------------ the reader's request */

test("the server refuses exactly the questions the page says it cannot answer", async () => {
  // The page and the server share one check; a second copy would drift, and
  // the page would offer a question the server then declines.
  const { ask, task, calls } = await repository();
  const refusal = "The repository does not contain bibliometric or forward-looking data.";
  for (const question of [
    "How many citations do these papers have?",
    "What is the h-index of these authors?",
    "What is the impact factor of these journals?",
    "How many citations will these papers get next year?",
    "How many downloads do these papers have?",
    "What are the main research topics across these papers?",
    "Which papers are cited in the reference list of the reading study?",
    "Compare the methodologies used across these papers.",
  ]) {
    calls.length = 0;
    const result = await ask(question, { executionPlan: plan("search_evidence", "focused", question) });
    const refused = (result.limitations ?? []).includes(refusal);
    assert.equal(refused, isRefusedQuestion(question), `server and page disagree on: ${question}`);
    if (refused) {
      assert.equal(task("CHAT_SYNTHESIS").length, 0, `no answer is written for: ${question}`);
      assert.match(result.answer, /contains no information about/);
    }
  }
});

test("every answer writer sees the request as the reader wrote it", async () => {
  // The planner's restatement had dropped "in one paragraph", and the corpus
  // writer, the only one not shown the original, returned seven paragraphs.
  const { ask, task, calls, script, peerFeedback } = await repository();
  const asked = "Summarise this whole repository in one paragraph";
  const refined = "Summarise the repository";
  script((call) => (call.taskName === "CHAT_SYNTHESIS" ? { answer: `Peer feedback helped [Paper ${peerFeedback}].`, citedPaperIds: [peerFeedback], confidence: 0.9 } : null));

  await ask(asked, { executionPlan: plan("search_evidence", "focused", refined) });
  assert.match(user(task("CHAT_SYNTHESIS")[0]), new RegExp(`Original request: ${asked}\nRefined request: ${refined}`));

  calls.length = 0;
  await ask(asked, { executionPlan: plan("analyze_each_document", "complete", refined) });
  const perPaper = JSON.parse(user(task("CHAT_DOCUMENT_ANALYSIS")[0]));
  assert.equal(perPaper.originalRequest, asked);
  assert.equal(perPaper.refinedRequest, refined);

  calls.length = 0;
  await ask(asked, { executionPlan: plan("aggregate_corpus", "complete", refined) });
  assert.match(user(task("CHAT_CORPUS_REDUCE")[0]), new RegExp(`^Original request: ${asked}\n\nRefined request: ${refined}`));
});

test("the planner is told a collection summary is one summary, and is offered only real operations", async () => {
  const { ask, task } = await repository();
  await ask("Summarise this repository", { allowWeb: true });
  const planner = task("CHAT_EXECUTION_PLAN")[0];
  assert.ok(planner, "the planner was asked");
  // "Summarise this repository" went down the per-paper path: 17,176 characters across 49 paragraphs.
  assert.match(system(planner), /A request to summarise the collection is one summary of the corpus, not one summary per paper: it is aggregate_corpus\./);
  assert.match(system(planner), /Per-paper summaries are only what is wanted when the reader asks about each, every or per paper\./);
  // Web search runs after the answer; offered as an operation, it invited a plan the schema rejects.
  const request = JSON.parse(user(planner));
  assert.ok(request.availableTools.includes("search_evidence"));
  assert.equal(request.availableTools.includes("web_search"), false);
  assert.equal(request.webSearchAfterAnswer, true);
});

/* ------------------------------------------------------------- web search on */

test("with web search on, only small talk goes unsearched", async () => {
  // Live, "what does recent research outside these papers say" was answered as
  // conversation, with no search, saying no outside sources were available.
  const { ask, task, calls, script, peerFeedback } = await repository();
  const outside = "What does recent research outside these papers say about peer feedback?";
  script((call) => {
    if (call.taskName === "CHAT_EXECUTION_PLAN") return plan("converse", "focused", JSON.parse(user(call)).request);
    if (call.taskName === "CHAT_SYNTHESIS") return { answer: `Peer feedback improved revision quality [Paper ${peerFeedback}].`, citedPaperIds: [peerFeedback], confidence: 0.9 };
    if (call.taskName === "CHAT_CONVERSE") return "Hello! Ask me about your papers.";
    return null;
  });

  const searched = await ask(outside, { allowWeb: true });
  assert.equal(searched.execution?.source, "llm", "the planner's plan was used");
  assert.deepEqual(searched.execution?.operations, ["search_evidence"]);
  assert.equal(task("CHAT_CONVERSE").length, 0);
  assert.equal(task("CHAT_SYNTHESIS").length, 1, "the papers were searched for an answer");

  calls.length = 0;
  const unsearched = await ask(outside, { allowWeb: false });
  assert.deepEqual(unsearched.execution?.operations, ["converse"], "without web search the planner's reading stands");
  assert.equal(task("CHAT_CONVERSE").length, 1);

  calls.length = 0;
  const hello = await ask("hello, thanks for your help!", { allowWeb: true });
  assert.equal(hello.execution?.source, "llm");
  assert.deepEqual(hello.execution?.operations, ["converse"]);
  assert.equal(task("CHAT_SYNTHESIS").length, 0);
});

test("a cached answer is handed out as a copy", async () => {
  // A caller that adds web sources to the answer it was given must not add
  // them to the stored one, where the next reader would see them.
  const { ask } = await repository();
  const quiet = mock.method(console, "info", () => undefined);
  try {
    const question = "List all the papers in this repository";
    const first = await ask(question);
    const count = first.citations.length;
    assert.ok(count > 0);
    first.citations.push({ paperId: "Web 1", title: "A web page", year: "Web", href: "https://example.org", reason: "", sourceType: "web" });
    first.citations[0].title = "Changed by the first caller";

    const second = await ask(question);
    assert.equal(second.diagnostics.cached, true);
    assert.equal(second.citations.length, count, "what the first caller added is not stored");
    assert.notEqual(second.citations[0].title, "Changed by the first caller");
    second.citations.push({ paperId: "Web 2", title: "Another web page", year: "Web", href: "https://example.org/2", reason: "", sourceType: "web" });
    second.citations[0].title = "Changed by the second caller";

    const third = await ask(question);
    assert.equal(third.diagnostics.cached, true);
    assert.equal(third.citations.length, count, "what a cached answer's caller added is not stored either");
    assert.notEqual(third.citations[0].title, "Changed by the second caller");
  } finally {
    quiet.mock.restore();
  }
});

/* ---------------------------------------------------------- the scope route */

test("the composer's count and the answer's count come from the same scope", async () => {
  const { ask, owner, request } = await repository();
  const { GET } = await import("../src/app/api/chat/scope-summary/route");
  const response = await GET(request(`/api/chat/scope-summary?projectId=${PROJECT}`, { headers: owner }));
  assert.equal(response.status, 200);
  const summary = await response.json();
  const answer = await ask("List all the papers in this repository");
  // Four papers are stored, one still being analysed: both count three.
  assert.equal(summary.eligiblePaperCount, 3);
  assert.equal(answer.scopeSnapshot.eligiblePaperCount, summary.eligiblePaperCount);
  assert.equal(answer.diagnostics.paperCount, summary.eligiblePaperCount);
  assert.equal(summary.scopeLabel, answer.scopeSnapshot.label);
  assert.ok(
    summary.examples.some((example: { text: string }) => PAPERS.some((paper) => example.text.includes(paper.title.slice(0, 20)))),
    `no example names one of the reader's papers: ${JSON.stringify(summary.examples)}`
  );
  assert.ok(!JSON.stringify(summary).includes(UNFINISHED.title), "an unfinished paper is not offered");
});

test("the scope route refuses a caller who is not signed in, and answers its preflight", async () => {
  const { request } = await repository();
  const { GET, OPTIONS } = await import("../src/app/api/chat/scope-summary/route");
  const refused = await GET(request(`/api/chat/scope-summary?projectId=${PROJECT}`, { headers: { origin: SITE } }));
  assert.equal(refused.status, 401);
  assert.deepEqual(await refused.json(), { error: "Unauthorized" });
  assert.equal(refused.headers.get("access-control-allow-origin"), SITE, "the browser can read the refusal");

  const preflight = await OPTIONS(request("/api/chat/scope-summary", { method: "OPTIONS", headers: { origin: SITE } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), SITE);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Authorization/);
  const elsewhere = await OPTIONS(request("/api/chat/scope-summary", { method: "OPTIONS", headers: { origin: "https://elsewhere.example" } }));
  assert.equal(elsewhere.headers.get("access-control-allow-origin"), null);
});

/* --------------------------------------------- repository-wide answers, reviewed */

test("a repository-wide review sees every finding the answer was written from, and judges support apart from coverage", async () => {
  // Found on the pilot: the whole review prompt was cut at 24,000 characters,
  // draft first, so most batch findings never reached it.
  const { ask, task, script, peerFeedback } = await repository();
  const findings = `${"Batch finding about peer feedback and revision. ".repeat(640)}END OF BATCH FINDINGS`;
  assert.ok(findings.length > 30_000);
  script((call) => {
    if (call.taskName === "CHAT_CORPUS_MAP") return findings;
    if (call.taskName === "CHAT_CORPUS_REDUCE") return `Peer feedback is the most studied practice [Paper ${peerFeedback}].`;
    if (call.taskName === "CHAT_FAITHFULNESS") return { ...APPROVED, citedPaperIds: [peerFeedback] };
    return null;
  });
  await ask("What are the main themes across the repository?", { executionPlan: plan("aggregate_corpus", "complete", "What are the main themes?") });
  const review = task("CHAT_FAITHFULNESS")[0];
  assert.ok(user(review).includes("END OF BATCH FINDINGS"), "the review saw the end of the findings");
  assert.ok(!user(review).includes("[Evidence shortened here"));
  assert.match(system(review), /A claim is never unsupported because the draft leaves something out\./);
  assert.match(system(review), /need not name each paper, nor be longer than the reader asked for/);
  assert.match(system(review), /a claim that repeats one of them is supported, and an answer need not list the papers behind a count/);
});

test("a repository-wide answer and its review see the counted figures, and an answer of counts is not failed for naming no paper", async () => {
  // Found on the pilot: "which topics come up most often" was answered from
  // model-written batch summaries, and the review could not confirm a ranking.
  const { ask, task, script } = await repository();
  const counted = "Academic writing is the topic most often named across the repository, and two of the three papers use mixed-methods designs.";
  script((call) => {
    if (call.taskName === "CHAT_CORPUS_REDUCE") return counted;
    if (call.taskName === "CHAT_FAITHFULNESS") return { ...APPROVED, citedPaperIds: [] };
    return null;
  });
  const result = await ask("Which topics come up most often?", { executionPlan: plan("aggregate_corpus", "complete", "Which topics come up most often?") });

  const reduce = user(task("CHAT_CORPUS_REDUCE")[0]);
  assert.match(reduce, /Eligible papers: 3\n\n## Counted across all 3 papers in scope\n/);
  assert.match(reduce, /- Academic Writing: 1 paper\n/);
  assert.match(reduce, /Keywords:\n- rubric: 3 papers\n- feedback: 2 papers/);
  assert.match(reduce, /Use these counts for any claim about how often or how many/);
  assert.match(user(task("CHAT_FAITHFULNESS")[0]), /# Evidence\n## Counted across all 3 papers in scope/);
  assert.equal(result.answer, counted);
  assert.deepEqual(result.limitations, [], "an approved answer of counts is not marked unverified for citing no paper");
});

test("with stored themes, a repository-wide answer counts them as the dashboard does, methods apart (CHAT-11)", async () => {
  const { ask, task, script, ids } = await repository({ themes: true });
  script((call) => (call.taskName === "CHAT_CORPUS_REDUCE" ? "Academic writing is the most common theme." : null));
  await ask("Which themes come up most often?", { executionPlan: plan("aggregate_corpus", "complete", "Which themes come up most often?") });
  const reduce = user(task("CHAT_CORPUS_REDUCE")[0]);
  // Two spellings of one method are one theme; a paper counts once per theme.
  const [peer, mobile, teacher] = ids;
  assert.match(reduce, /## Themes, as the dashboard groups them \(a paper counts once per theme\)\n- Academic writing: 3 papers/);
  for (const id of [peer, mobile, teacher]) assert.ok(/- Academic writing: 3 papers \(([^)]*)\)/.exec(reduce)?.[1].includes(`Paper ${id}`), id);
  assert.match(reduce, new RegExp(`Research designs and methods:\\n- Mixed methods: 2 papers \\(Paper (?:${peer}, Paper ${mobile}|${mobile}, Paper ${peer})\\)`));
  // With themes, the raw labels are not sent as a second, different count.
  assert.doesNotMatch(reduce, /Topic labels as each paper's analysis named them/);
  assert.match(reduce, /Keywords:\n- rubric: 3 papers\n- feedback: 2 papers/);
  // A batch sees part of the repository, so it is told not to count.
  assert.match(system(task("CHAT_CORPUS_MAP")[0]), /Do not count papers or topics: this is one batch of the repository/);
});

/* ------------------------------------------------- focused answers, reviewed */

test("a focused answer whose review cannot be read or does not run is shown marked, never as checked", async () => {
  const { ask, calls, script, peerFeedback, UNCHECKED_ANSWER_LIMITATION } = await repository();
  const focused = plan("search_evidence", "focused", QUESTION);
  const coverage = "Focused retrieval reports relevant evidence coverage, not exhaustive corpus coverage.";
  const draft = `Peer feedback improved revision quality [Paper ${peerFeedback}].`;
  const quiet = mock.method(console, "warn", () => undefined);
  try {
    const outcomes: Array<[string, unknown, number, RegExp, string[]]> = [
      ["approved", { ...APPROVED, citedPaperIds: [peerFeedback] }, 0.6, /^Peer feedback improved revision quality/, [coverage]],
      ["unreadable", "I cannot judge this answer.", 0.6, /^Peer feedback improved revision quality/, [coverage, UNCHECKED_ANSWER_LIMITATION]],
      ["no response", null, 0.6, /^Peer feedback improved revision quality/, [coverage, UNCHECKED_ANSWER_LIMITATION]],
      ["failed", new Error("provider timeout"), 0.6, /^Peer feedback improved revision quality/, [coverage, UNCHECKED_ANSWER_LIMITATION]],
      // A draft too weak to show as it is, and nothing checked it: the fallback.
      ["unreadable, weak draft", "I cannot judge this answer.", 0.5, /^\*\*I could not finish this answer\.\*\*/, [coverage]],
    ];
    for (const [name, review, confidence, answer, limitations] of outcomes) {
      calls.length = 0;
      script((call) => {
        if (call.taskName === "CHAT_SYNTHESIS") return { answer: draft, citedPaperIds: [peerFeedback], confidence };
        if (call.taskName === "CHAT_FAITHFULNESS") {
          if (review instanceof Error) throw review;
          return review;
        }
        return null;
      });
      const result = await ask(`${QUESTION} (${name})`, { executionPlan: focused });
      assert.equal(calls.filter((call) => call.taskName === "CHAT_FAITHFULNESS").length, 1, name);
      assert.match(result.answer, answer, name);
      assert.deepEqual(result.limitations, limitations, name);
    }
  } finally {
    quiet.mock.restore();
  }
});

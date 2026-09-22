import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CAPABILITIES,
  LIMITS,
  detectUnavailableMetric,
  exampleQuestions,
  followUpSuggestions,
  isRefusedQuestion,
  scopeDescription,
} from "../src/lib/chat-guidance";

const PAPERS = [
  {
    paperId: "1",
    title: "Effects of Personal Intelligence Reading Instruction on Thai university students",
    year: "2016",
  },
  { paperId: "2", title: "Enhancing Learner Autonomy amongst Young EFL Learners", year: "2017" },
  { paperId: "3", title: "Rhythmical Patterns in the Readings of Thai Learners", year: "Unknown" },
];

/* ------------------------------------------------------------ example questions */

test("a reader with papers gets three examples drawn from their own repository", () => {
  const examples = exampleQuestions(PAPERS, "Test 2 repository");
  assert.equal(examples.length, 3);
  // One of them must name a paper the reader will recognise, or the examples
  // teach nothing about what this assistant can do with these papers.
  assert.ok(
    examples.some((example) => example.text.includes("Effects of Personal Intelligence")),
    `no example names a real paper: ${examples.map((e) => e.text).join(" | ")}`
  );
  assert.ok(examples.some((example) => example.text.includes("Test 2 repository")));
});

test("an empty repository still gets three usable examples", () => {
  // A reader who has uploaded nothing needs to know what to do next, and the
  // count and listing questions work with nothing analysed.
  const examples = exampleQuestions([], "Test 2 repository");
  assert.equal(examples.length, 3);
  for (const example of examples) {
    assert.ok(example.text.trim().length > 10);
  }
});

test("a single-paper repository is not offered a comparison", () => {
  const examples = exampleQuestions([PAPERS[0]], "Test 2 repository");
  assert.equal(examples.length, 3);
  assert.equal(
    examples.some((example) => example.kind === "comparison"),
    false,
    "comparing one paper with itself is not a question"
  );
});

test("papers with blank titles are skipped rather than quoted empty", () => {
  const examples = exampleQuestions(
    [{ paperId: "1", title: "   ", year: "2016" }, PAPERS[1]],
    "Test 2 repository"
  );
  assert.ok(examples.some((example) => example.text.includes("Enhancing Learner Autonomy")));
  assert.equal(examples.some((example) => /""/.test(example.text)), false);
});

test("a Thai title is shortened by characters, not by spaces", () => {
  // Thai writes without spaces between words, so a word count does not bound
  // it and the whole title would be quoted.
  const thai = "การพัฒนาความสามารถในการอ่านภาษาอังกฤษของนักเรียนไทยระดับมัธยมศึกษาตอนปลายโดยใช้กลวิธี";
  const examples = exampleQuestions([{ paperId: "1", title: thai, year: "2560" }], "คลัง");
  const quoted = examples.find((example) => example.kind === "specific");
  assert.ok(quoted);
  const fragment = quoted!.text.match(/"([^"]+)"/)?.[1] ?? "";
  assert.ok(fragment.length > 0 && fragment.length <= 40, `fragment was ${fragment.length} chars`);
});

test("no example is a question the assistant would refuse", () => {
  // Offering a question and then declining it wastes the reader's time.
  for (const example of exampleQuestions(PAPERS, "Test 2 repository")) {
    assert.equal(isRefusedQuestion(example.text), false, `refused example: ${example.text}`);
  }
  for (const example of exampleQuestions([], "Test 2 repository")) {
    assert.equal(isRefusedQuestion(example.text), false, `refused example: ${example.text}`);
  }
});

/* ------------------------------------------------------------------- refusals */

test("the refusal check is the server's own, not a second copy", () => {
  // A separate list would drift, and the failure would be the page offering a
  // question the server then declines.
  const server = readFileSync(
    new URL("../src/lib/repository-chat.ts", import.meta.url),
    "utf8"
  );
  assert.match(server, /import \{\s*detectUnavailableMetric/);
  assert.equal(
    /const UNAVAILABLE_METRIC_PATTERNS/.test(server),
    false,
    "the server must not keep its own copy of the refusal patterns"
  );
});

test("questions the repository cannot answer are recognised", () => {
  const refused = [
    "How many citations do these papers have?",
    "What is the h-index of these authors?",
    "What is the impact factor of these journals?",
    "How many citations will these papers get next year?",
    "How many downloads do these papers have?",
  ];
  for (const question of refused) {
    assert.ok(isRefusedQuestion(question), `not recognised as refused: ${question}`);
    assert.ok(detectUnavailableMetric(question));
  }
});

test("an ordinary question is not mistaken for a refused one", () => {
  const fine = [
    "What are the main research topics across these papers?",
    "Which papers are cited in the reference list of the reading study?",
    "Compare the methodologies used across these papers.",
    "How many papers are in this repository?",
    "How many words is each paper?",
  ];
  for (const question of fine) {
    assert.equal(isRefusedQuestion(question), false, `wrongly refused: ${question}`);
  }
});

/* ------------------------------------------------------- follow-up suggestions */

test("an unmet evidence need becomes a follow-up", () => {
  const suggestions = followUpSuggestions({
    missingEvidenceNeeds: ["Sample sizes for the intervention studies"],
  });
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0], /sample sizes for the intervention studies/i);
});

test("a focused answer offers to widen to the rest of the corpus", () => {
  const suggestions = followUpSuggestions({ citedPaperCount: 2, scopedPaperCount: 38 });
  assert.ok(suggestions.some((suggestion) => /other 36 papers/.test(suggestion)));
});

test("an answer that already covered everything offers no widening", () => {
  assert.deepEqual(followUpSuggestions({ citedPaperCount: 5, scopedPaperCount: 5 }), []);
});

test("suggestions never propose something the assistant would refuse", () => {
  // The acceptance criterion, asserted directly.
  const suggestions = followUpSuggestions({
    missingEvidenceNeeds: [
      "Citation counts for each paper",
      "How many times cited each work is",
      "Sample sizes for the intervention studies",
    ],
  });
  for (const suggestion of suggestions) {
    assert.equal(isRefusedQuestion(suggestion), false, `refused suggestion: ${suggestion}`);
  }
  assert.ok(suggestions.some((suggestion) => /sample sizes/i.test(suggestion)));
});

test("at most three suggestions, and never a duplicate", () => {
  const suggestions = followUpSuggestions({
    missingEvidenceNeeds: ["Alpha evidence", "Beta evidence", "Gamma evidence", "Delta evidence"],
    citedPaperCount: 1,
    scopedPaperCount: 9,
  });
  assert.ok(suggestions.length <= 3);
  assert.equal(new Set(suggestions).size, suggestions.length);
});

test("an answer with nothing missing suggests nothing", () => {
  assert.deepEqual(followUpSuggestions({}), []);
});

test("a need too short to make a question is skipped", () => {
  assert.deepEqual(followUpSuggestions({ missingEvidenceNeeds: ["data", "n"] }), []);
});

/* ------------------------------------------------------------ scope description */

test("the scope line states how many papers a question will search", () => {
  assert.equal(
    scopeDescription("Test 2 repository", 5),
    "Searching 5 analysed papers in Test 2 repository"
  );
  assert.equal(
    scopeDescription("Test 2 repository", 1),
    "Searching 1 analysed paper in Test 2 repository"
  );
});

test("an empty scope says so rather than claiming to search nothing", () => {
  assert.equal(scopeDescription("Test 2 repository", 0), "Test 2 repository has no analysed papers yet");
});

test("an unknown count names the scope without inventing a number", () => {
  // Before the count arrives, or when it cannot be read, the line must not
  // claim zero: zero is a fact, and "not yet known" is a different one.
  assert.equal(scopeDescription("Test 2 repository", null), "Searching Test 2 repository");
});

/* ----------------------------------------------------------- capability listing */

test("the capability list is written in a researcher's terms", () => {
  assert.ok(CAPABILITIES.length >= 4);
  const text = CAPABILITIES.map((c) => `${c.label} ${c.detail}`).join(" ");
  // Internal operation names mean nothing to a reader.
  for (const jargon of ["aggregate_corpus", "search_evidence", "analyze_each_document", "rerank"]) {
    assert.equal(text.includes(jargon), false, `internal vocabulary leaked: ${jargon}`);
  }
});

test("every stated limit corresponds to something actually refused", () => {
  // Claiming a limit that is not enforced misleads as much as hiding one.
  assert.ok(LIMITS.length >= 3);
  assert.ok(LIMITS.some((limit) => /citation/i.test(limit.label)));
  assert.ok(LIMITS.some((limit) => /future/i.test(limit.label)));
  assert.ok(isRefusedQuestion("How many citations do these papers have?"));
  assert.ok(isRefusedQuestion("How many citations will these papers get next year?"));
});

test("each limit explains why, not just that", () => {
  for (const limit of LIMITS) {
    assert.ok(limit.detail.length > 20, `limit "${limit.label}" gives no reason`);
  }
});

/* ------------------------------------------------------------- the page wiring */

function page(): string {
  return [
    readFileSync(new URL("../src/components/chat/ChatClient.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/components/chat/ChatIntro.tsx", import.meta.url), "utf8"),
  ].join(String.fromCharCode(10));
}

test("the empty page no longer asks where to begin and says nothing else", () => {
  // Checked against the file that renders it, not the whole page: the phrase
  // still appears in a comment explaining why it went, and a test that fails on
  // its own explanation is a test nobody will keep.
  const client = readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
  assert.equal(
    client.includes("Where should we begin?"),
    false,
    "the bare heading must be replaced by something that teaches the page"
  );
  assert.match(client, /<ChatIntro/);
});

test("examples are clickable and send as questions", () => {
  const source = page();
  assert.match(source, /onAsk=\{\(question\) => void askQuestion\(question\)\}/);
  // React state is not readable in the tick it is set, so the clicked text has
  // to be passed to the send rather than routed through the draft.
  assert.match(source, /async function handleNormalSend\(promptOverride\?: string\)/);
  assert.match(source, /const prompt = \(promptOverride \?\? draft\)\.trim\(\)/);
});

test("the composer states what a question will search", () => {
  const source = page();
  assert.match(source, /data-testid="composer-scope"/);
  assert.match(source, /scopeDescription\(/);
});

test("the composer count and the answer count come from the same loader", () => {
  // The acceptance criterion: the scope in the composer must match the scope
  // the answer reports. Both now read loadRepositoryContext - the composer via
  // the scope-summary route, the answer directly - so they cannot disagree
  // without the repository itself having changed between the two.
  const route = readFileSync(
    new URL("../src/app/api/chat/scope-summary/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /import \{ loadRepositoryContext \} from "@\/lib\/repository-chat"/);
  assert.match(route, /eligiblePaperCount: papers\.length/);
  assert.match(route, /papers = context\.papers\.map/);
});

test("the composer never invents a count it does not have", () => {
  // It used to pass a hardcoded zero, so it claimed "0 papers" for every scope
  // until an answer came back.
  const source = readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /scopeSummary\?\.eligiblePaperCount \?\? null/);
});

test("a follow-up is offered only under the newest answer", () => {
  // Suggestions under every old answer would be noise, and acting on one would
  // ask a question about an answer that is no longer on screen.
  const source = readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /message === visibleMessages\[visibleMessages\.length - 1\]/);
  assert.match(source, /<FollowUpSuggestions/);
});

test("a widening suggestion uses the answer's own corpus size", () => {
  // Reading it from the composer's scope would let a suggestion claim a
  // different corpus than the answer it sits under, if the scope had changed.
  const source = readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /scopedPaperCount: coveredPaperCount\(message\.metadata\)/);
});

test("the scope route refuses an unauthenticated caller and answers its preflight", () => {
  const route = readFileSync(
    new URL("../src/app/api/chat/scope-summary/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /export async function OPTIONS/);
  assert.match(route, /status: 401/);
  assert.match(route, /withChatCors/);
});

/* --------------------------------------------- the reader's own words survive */

function server(): string {
  return readFileSync(new URL("../src/lib/repository-chat.ts", import.meta.url), "utf8");
}

test("every synthesis step sees the request as the reader wrote it", () => {
  // The corpus reduce step was the only one that did not, so "summarise this
  // whole repository in one paragraph" came back as seven paragraphs: the
  // planner's refined question had dropped the constraint and nothing
  // downstream could know it had been asked for.
  const source = server();
  assert.match(source, /Original request: \$\{input\.prompt\}/);
  assert.match(source, /originalRequest: input\.prompt/);
  const reduce = source.slice(source.indexOf("CHAT_CORPUS_REDUCE") - 2200, source.indexOf("CHAT_CORPUS_REDUCE"));
  assert.match(reduce, /Original request: \$\{input\.prompt\}/);
});

test("summarising the collection is one summary, not one per paper", () => {
  // "analyze_each_document when every document needs an explanation, summary,
  // classification" pulled "summarise this repository" to the per-document
  // path, which answered a summary request with 17,176 characters across 49
  // paragraphs and 16 headings.
  const source = server();
  assert.match(source, /A request to summarise the collection is one summary of the corpus, not one summary per paper/);
  assert.match(source, /Per-paper summaries are only what is wanted when the reader asks about each, every or per paper/);
});

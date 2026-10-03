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

// That the server refuses exactly what isRefusedQuestion refuses is run in
// chat-answer-behaviour-pipeline.test.ts.

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

// The empty page, its examples and composer are rendered, and the scope
// route and the reader's own words through every answer writer are run, in
// chat-answer-behaviour-page.test.ts and chat-answer-behaviour-pipeline.test.ts.
// These two stay as text: the page's answers arrive by an effect, which a
// static render never runs, so no answer is on screen to sit under.

function client(): string {
  return readFileSync(new URL("../src/components/chat/ChatClient.tsx", import.meta.url), "utf8");
}

test("a follow-up is offered only under the newest answer", () => {
  // Suggestions under every old answer would be noise, and acting on one would
  // ask a question about an answer that is no longer on screen.
  const source = client();
  assert.match(source, /message === visibleMessages\[visibleMessages\.length - 1\]/);
  assert.match(source, /<FollowUpSuggestions/);
});

test("a widening suggestion uses the answer's own corpus size", () => {
  // Reading it from the composer's scope would let a suggestion claim a
  // different corpus than the answer it sits under, if the scope had changed.
  assert.match(client(), /scopedPaperCount: coveredPaperCount\(message\.metadata\)/);
});

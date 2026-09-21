import assert from "node:assert/strict";
import test from "node:test";
import { papersNamedIn } from "../src/lib/repository-chat";
import type { RepositoryPaper } from "../src/lib/repository-chat";

function paper(paperId: string, title: string): RepositoryPaper {
  return {
    paperId, runId: `run-${paperId}`, folderId: "f", title, year: "2024",
    abstract: "", methods: "", results: "", conclusion: "", content: "",
    contentHash: `h-${paperId}`, contentSource: "full_text", totalWords: 0,
    termCounts: {}, topics: new Map(), keywords: new Map(),
  };
}

const PAPERS = [
  paper("1", "Enhancing Learner Autonomy amongst Young EFL Learners in a Rural Area"),
  paper("2", "Rhythmical Patterns in the Readings of Thai Learners"),
  paper("3", "Effects of Personal Intelligence Reading Instruction"),
];

test("a paper named by its distinctive words is recognised", () => {
  const text = "The learner autonomy study in a rural area found sustained gains.";
  const named = papersNamedIn(text, PAPERS);
  assert.deepEqual(named.map((p) => p.paperId), ["1"]);
});

test("several papers named in one passage are all recognised", () => {
  const text =
    "Learner autonomy among young EFL learners improved, while rhythmical patterns in Thai learners' readings affected comprehensibility.";
  const named = papersNamedIn(text, PAPERS);
  assert.deepEqual(named.map((p) => p.paperId).sort(), ["1", "2"]);
});

test("an unattributed claim names nothing", () => {
  // Live regression: the cross-paper overview made claims with no attribution.
  const text = "The papers converge on the view that context matters more than method choice.";
  assert.deepEqual(papersNamedIn(text, PAPERS), []);
});

test("a passing mention of one common word is not treated as attribution", () => {
  // "Learners" alone appears in several titles and identifies none of them.
  const text = "Learners generally improved across the corpus.";
  assert.deepEqual(papersNamedIn(text, PAPERS), []);
});

test("matching ignores case", () => {
  const text = "RHYTHMICAL PATTERNS in the READINGS of Thai learners were analysed.";
  assert.deepEqual(papersNamedIn(text, PAPERS).map((p) => p.paperId), ["2"]);
});

test("an empty passage names nothing", () => {
  assert.deepEqual(papersNamedIn("", PAPERS), []);
});

test("a paper with no distinctive words is never falsely matched", () => {
  const short = [paper("9", "A B C")];
  assert.deepEqual(papersNamedIn("Some text about A and B and C.", short), []);
});

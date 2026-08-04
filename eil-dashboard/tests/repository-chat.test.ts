import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepositoryTermCounts,
  countTermInRepositoryText,
  tokenizeRepositoryText,
} from "../src/lib/repository-text";
import { fallbackPromptPlan } from "../src/lib/repository-chat";
import {
  rankRepositoryEvidence,
  validateInlinePaperCitations,
} from "../src/lib/repository-retrieval";

test("normalizes case while preserving whole-word boundaries", () => {
  const text = "Feedback improves feedback-informed teaching, but feed is different.";
  assert.equal(countTermInRepositoryText(text, "feedback"), 2);
  assert.equal(countTermInRepositoryText(text, "feed"), 1);
});

test("counts an exact multi-word phrase without counting reordered tokens", () => {
  const text = "Peer feedback helps. Peer feedback matters. Feedback from a peer is different.";
  assert.equal(countTermInRepositoryText(text, "peer feedback"), 2);
});

test("builds a reusable normalized term index", () => {
  const result = buildRepositoryTermCounts("Learners' goals and learners' outcomes");
  assert.equal(result.totalWords, 5);
  assert.equal(result.termCounts["learners'"], undefined);
  assert.equal(result.termCounts["learners' goals"], undefined);
  assert.deepEqual(tokenizeRepositoryText("Self-regulated learning"), ["self", "regulated", "learning"]);
});

test("does not attach charts to plain repository topic summaries", () => {
  const plan = fallbackPromptPlan("Summarize the main topics in this repository", false);
  assert.equal(plan.intent, "topic_summary");
  assert.equal(plan.needsChart, false);
});

test("attaches charts only when chart language or chart mode is explicit", () => {
  const chartPlan = fallbackPromptPlan("Show the main topics as a bar chart", false);
  assert.equal(chartPlan.intent, "topic_chart");
  assert.equal(chartPlan.needsChart, true);

  const forcedPlan = fallbackPromptPlan("Summarize the main topics", true);
  assert.equal(forcedPlan.needsChart, true);
});

test("hybrid retrieval rewards direct evidence over diluted body overlap", () => {
  const candidates = rankRepositoryEvidence(
    [
      {
        paperId: "101",
        title: "Peer feedback and self-regulated writing",
        abstract: "This study tests how peer feedback changes writing outcomes and learner regulation.",
        methods: "A controlled classroom intervention was used.",
        results: "Peer feedback improved revision quality.",
        conclusion: "Feedback supported writing development.",
        content: "Peer feedback improved revision quality in the intervention group.",
        topics: ["Peer feedback", "Self-regulated learning"],
        keywords: ["writing", "revision"],
      },
      {
        paperId: "202",
        title: "General language curriculum review",
        abstract: "A broad overview of curriculum and language education.",
        methods: "Document review.",
        results: "The appendix repeatedly lists writing and feedback terminology.",
        conclusion: "Curriculum terminology varies.",
        content: "writing feedback ".repeat(30),
        topics: ["Curriculum"],
        keywords: ["language"],
      },
    ],
    ["How does peer feedback affect self-regulated writing?"],
    2
  );

  assert.equal(candidates[0].paperId, "101");
  assert.equal(candidates.length, 2);
});

test("citation validation rejects paper ids outside retrieved evidence", () => {
  const result = validateInlinePaperCitations(
    "The intervention improved revision quality and supported more deliberate learner reflection [Paper 101], but another unrelated result was also claimed [Paper 999].",
    ["101", "202"]
  );

  assert.deepEqual(result.citedPaperIds, ["101"]);
  assert.deepEqual(result.invalidPaperIds, ["999"]);
  assert.equal(result.hasSubstantiveText, true);
});

test("fallback plan carries safe defaults for the richer retrieval contract", () => {
  const plan = fallbackPromptPlan("Compare the methods used in my papers", false);
  assert.deepEqual(plan.evidenceNeeds, []);
  assert.equal(plan.answerLanguage, "same as user");
});

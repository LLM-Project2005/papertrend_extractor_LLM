import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepositoryTermCounts,
  countTermInRepositoryText,
  tokenizeRepositoryText,
} from "../src/lib/repository-text";

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

import assert from "node:assert/strict";
import test from "node:test";
import { detectUnavailableMetric, unavailableMetricAnswer } from "../src/lib/repository-chat";

test("bibliometric questions are recognised as unanswerable here", () => {
  assert.equal(detectUnavailableMetric("How many citations do these papers have?"), "citation_counts");
  assert.equal(detectUnavailableMetric("What is the citation count?"), "citation_counts");
  assert.equal(detectUnavailableMetric("How many times cited is the 2016 paper?"), "citation_counts");
  assert.equal(detectUnavailableMetric("What is the h-index of these authors?"), "author_metrics");
  assert.equal(detectUnavailableMetric("What is the impact factor of the journal?"), "venue_metrics");
  assert.equal(detectUnavailableMetric("How many downloads does it have?"), "usage_metrics");
});

test("future predictions are recognised", () => {
  // Live regression: this produced "approximately 3 citations, range 0-10" in a
  // table, attributed to a paper that contains no such data.
  assert.equal(
    detectUnavailableMetric("How many citations will these papers get next year?"),
    "citation_counts"
  );
  assert.equal(
    detectUnavailableMetric("Which paper do you predict will have the most impact?"),
    "future_prediction"
  );
});

test("questions the repository can answer are not intercepted", () => {
  for (const prompt of [
    "What are the main topics across these papers?",
    "Summarise the reading assessment study.",
    "Which paper is the longest?",
    "How many papers do I have?",
    "What methodology did they use?",
    "List the references cited in this paper.",
    "What years were these published?",
  ]) {
    assert.equal(detectUnavailableMetric(prompt), null, `must not intercept: ${prompt}`);
  }
});

test("the refusal names what is missing and where to find it", () => {
  const answer = unavailableMetricAnswer("citation_counts", "Test 2 repository", false);
  assert.match(answer, /Test 2 repository/);
  assert.match(answer, /how often these papers have been cited/);
  assert.match(answer, /Scopus|Web of Science|Google Scholar/);
});

test("the refusal offers what can be answered instead", () => {
  const answer = unavailableMetricAnswer("author_metrics", "Test 2 repository", false);
  assert.match(answer, /I can answer questions about what these papers say/);
});

test("the refusal never invents a number", () => {
  for (const metric of ["citation_counts", "author_metrics", "venue_metrics", "future_prediction", "usage_metrics"] as const) {
    const answer = unavailableMetricAnswer(metric, "Repo", false);
    assert.doesNotMatch(answer, /approximately \d/, `${metric} must not estimate`);
    assert.doesNotMatch(answer, /\brange\b\s*\d/, `${metric} must not give a range`);
  }
});

test("a Thai question is refused in Thai", () => {
  const answer = unavailableMetricAnswer("citation_counts", "คลังทดสอบ", true);
  assert.match(answer, /[฀-๿]/u);
  assert.match(answer, /Scopus/);
});

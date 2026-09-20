import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepositoryFactsAnswer,
  detectRepositoryFacts,
} from "../src/lib/repository-chat";
import type { RepositoryPaper, RepositoryRunStats } from "../src/lib/repository-chat";

function paper(title: string, year: string, totalWords: number): RepositoryPaper {
  return {
    paperId: title,
    runId: `run-${title}`,
    folderId: "folder-1",
    title,
    year,
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content: "",
    contentHash: `hash-${title}`,
    contentSource: "full_text",
    totalWords,
    termCounts: {},
    topics: new Map(),
    keywords: new Map(),
  };
}

const PAPERS = [
  paper("Alpha", "2016", 6_150),
  paper("Beta", "2017", 3_618),
  paper("Gamma", "2017", 8_754),
  paper("Delta", "Unknown", 1_726),
];

const RUN_STATS: RepositoryRunStats = {
  total: 6,
  succeeded: 4,
  queued: 1,
  processing: 0,
  failed: 1,
  canceled: 0,
  other: 0,
};

test("year questions are detected in English and Thai", () => {
  assert.equal(detectRepositoryFacts("What years were these published?").years, true);
  assert.equal(detectRepositoryFacts("Give me a publication year breakdown").years, true);
  assert.equal(detectRepositoryFacts("เอกสารเหล่านี้ตีพิมพ์ปีไหน").years, true);
  assert.equal(detectRepositoryFacts("How many papers do I have?").years, false);
});

test("extreme questions are detected separately from year questions", () => {
  const oldest = detectRepositoryFacts("Which is the oldest paper?");
  assert.equal(oldest.yearExtremes, true);
  const longest = detectRepositoryFacts("Which paper is the longest?");
  assert.equal(longest.lengthExtremes, true);
  assert.equal(longest.yearExtremes, false);
});

test("status questions are detected", () => {
  assert.equal(detectRepositoryFacts("Did any files fail analysis?").status, true);
  assert.equal(detectRepositoryFacts("What is the processing status?").status, true);
});

test("a year question returns a real year breakdown, not the generic overview", () => {
  const answer = buildRepositoryFactsAnswer(PAPERS, "Test repo", "What years were these published?", RUN_STATS);
  assert.match(answer, /Papers by publication year/);
  assert.match(answer, /\| 2016 \| 1 \|/);
  assert.match(answer, /\| 2017 \| 2 \|/);
  assert.match(answer, /\| Unknown \| 1 \|/);
});

test("years are listed in chronological order with Unknown last", () => {
  const answer = buildRepositoryFactsAnswer(PAPERS, "Test repo", "publication year breakdown", RUN_STATS);
  assert.ok(answer.indexOf("| 2016 |") < answer.indexOf("| 2017 |"));
  assert.ok(answer.indexOf("| 2017 |") < answer.indexOf("| Unknown |"));
});

test("oldest and newest name the actual papers", () => {
  const answer = buildRepositoryFactsAnswer(
    PAPERS,
    "Test repo",
    "Which is the oldest and which is the newest paper?",
    RUN_STATS
  );
  assert.match(answer, /Oldest \(2016\)\*\*: Alpha/);
  assert.match(answer, /Newest \(2017\)\*\*: Gamma/);
  // Unknown-year papers must be disclosed as excluded, not silently dropped.
  assert.match(answer, /1 paper has an unknown year and are excluded|unknown year/i);
});

test("oldest and newest degrade honestly when no year is known", () => {
  const undated = [paper("One", "Unknown", 10), paper("Two", "Unknown", 20)];
  const answer = buildRepositoryFactsAnswer(undated, "Test repo", "Which is the oldest paper?", RUN_STATS);
  assert.match(answer, /No paper in this scope has a known publication year/);
});

test("longest and shortest report real word totals", () => {
  const answer = buildRepositoryFactsAnswer(PAPERS, "Test repo", "Which paper is the longest?", RUN_STATS);
  assert.match(answer, /Longest \(8,754 words\)\*\*: Gamma/);
  assert.match(answer, /Shortest \(1,726 words\)\*\*: Delta/);
});

test("status questions produce a status table", () => {
  const answer = buildRepositoryFactsAnswer(PAPERS, "Test repo", "Did any files fail?", RUN_STATS);
  assert.match(answer, /Analysis status/);
  assert.match(answer, /\| Succeeded \| 4 \|/);
  assert.match(answer, /\| Failed \| 1 \|/);
  assert.match(answer, /\| Queued \| 1 \|/);
  // Zero-count rows are noise.
  assert.doesNotMatch(answer, /\| Canceled \|/);
});

test("a plain count question still returns just the overview", () => {
  const answer = buildRepositoryFactsAnswer(PAPERS, "Test repo", "How many papers do I have?", RUN_STATS);
  assert.doesNotMatch(answer, /Papers by publication year/);
  assert.doesNotMatch(answer, /Oldest and newest/);
  assert.match(answer, /successfully analyzed paper/);
});

test("several facets can be answered in one reply", () => {
  const answer = buildRepositoryFactsAnswer(
    PAPERS,
    "Test repo",
    "What years are these, and which is the longest?",
    RUN_STATS
  );
  assert.match(answer, /Papers by publication year/);
  assert.match(answer, /Longest and shortest/);
});

test("the overview is always appended so counts are never lost", () => {
  const answer = buildRepositoryFactsAnswer(PAPERS, "Test repo", "Which is the oldest?", RUN_STATS);
  assert.match(answer, /Oldest and newest/);
  assert.match(answer, /successfully analyzed paper/);
});

test("Thai questions produce Thai section headings", () => {
  const answer = buildRepositoryFactsAnswer(PAPERS, "คลังทดสอบ", "เอกสารเหล่านี้ตีพิมพ์ปีไหน", RUN_STATS);
  assert.match(answer, /จำนวนเอกสารตามปี/);
});

test("a fact question is not mistaken for a general listing request", () => {
  // Live regression: "Which paper is the longest?" was routed to list_documents
  // by the planner and answered with a plain list of every title.
  const listing = detectRepositoryFacts("List every paper title.");
  assert.equal(listing.lengthExtremes, false);
  assert.equal(listing.yearExtremes, false);
  assert.equal(listing.years, false);
  assert.equal(listing.status, false);

  const longest = detectRepositoryFacts("Which paper is the longest?");
  assert.equal(longest.lengthExtremes, true);
});

test("Thai extreme questions are detected", () => {
  assert.equal(detectRepositoryFacts("เอกสารไหนยาวที่สุด").lengthExtremes, true);
  assert.equal(detectRepositoryFacts("เอกสารไหนเก่าสุด").yearExtremes, true);
});

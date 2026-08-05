import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepositoryTermCounts,
  countTermInRepositoryText,
  tokenizeRepositoryText,
} from "../src/lib/repository-text";
import {
  buildRepositoryStatisticsSummary,
  fallbackExecutionPlan,
  fallbackPromptPlan,
  formatPaperReferencesForReaders,
  inferConversationAnswerLanguage,
  requestsRepositoryStatistics,
} from "../src/lib/repository-chat";
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
  assert.equal(plan.retrievalMode, "comparative");
});

test("repository-wide requests use exhaustive retrieval planning", () => {
  const plan = fallbackPromptPlan(
    "Synthesize the major findings across all papers in the entire repository",
    false
  );
  assert.equal(plan.retrievalMode, "exhaustive");
});

test("retrieval candidate pools can grow beyond the original sixteen-paper window", () => {
  const documents = Array.from({ length: 40 }, (_, index) => ({
    paperId: String(index + 1),
    title: `Repository paper ${index + 1}`,
    abstract: `Shared repository evidence with distinct sample ${index + 1}.`,
    methods: "Survey method.",
    results: "Repository-wide evidence was reported.",
    conclusion: "The finding contributes to corpus coverage.",
    content: `Repository-wide evidence and corpus coverage sample ${index + 1}.`,
    topics: [`Topic ${index % 8}`],
    keywords: ["repository evidence"],
  }));
  const candidates = rankRepositoryEvidence(
    documents,
    ["repository-wide evidence and corpus coverage"],
    40
  );
  assert.equal(candidates.length, 40);
});

test("routes repository cardinality questions to deterministic statistics", () => {
  const prompts = [
    "How many papers are in the repository?",
    "What is the total number of analyzed articles in this folder?",
    "Give me the corpus size",
    "\u0e21\u0e35\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14\u0e01\u0e35\u0e48\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07",
  ];
  prompts.forEach((prompt) => {
    assert.equal(requestsRepositoryStatistics(prompt), true, prompt);
    assert.equal(fallbackPromptPlan(prompt, false).intent, "repository_statistics", prompt);
  });
});

test("repository statistics distinguish total files from successfully analyzed papers", () => {
  const papers = Array.from({ length: 35 }, (_, index) => ({
    year: index < 3 ? "Unknown" : String(2000 + (index % 20)),
    folderId: "folder-a",
    totalWords: 1_000,
  }));
  const summary = buildRepositoryStatisticsSummary(
    papers,
    "EFL Repository",
    "How many papers are in the repository?",
    {
      total: 40,
      succeeded: 35,
      queued: 0,
      processing: 0,
      failed: 5,
      canceled: 0,
      other: 0,
    }
  );
  assert.match(summary, /\*\*40 total files\*\*/);
  assert.match(summary, /\*\*35 successfully analyzed papers\*\*/);
  assert.match(summary, /5 files failed analysis/);
  assert.match(summary, /3 papers have an unknown publication year/);
  assert.match(summary, /35,000 words/);
});

test("repository topic charts use whole-scope aggregation", () => {
  const plan = fallbackPromptPlan("Display the repository topics as a bar chart", false);
  assert.equal(plan.intent, "topic_chart");
  assert.equal(plan.retrievalMode, "exhaustive");
});

test("word-frequency questions remain separate from repository cardinality", () => {
  const plan = fallbackPromptPlan('Count the word "feedback" across all papers', false);
  assert.equal(plan.intent, "word_count");
  assert.equal(plan.retrievalMode, "exhaustive");
});

test("Chat V2 fallback preserves complete title-list scope", () => {
  const plan = fallbackExecutionPlan("Please give me the names of every document in this repository");
  assert.equal(plan.operation, "list_documents");
  assert.equal(plan.scopeMode, "complete");
});

test("Chat V2 fallback treats explain-each as complete document analysis", () => {
  const plan = fallbackExecutionPlan("Explain each file in the selected folder");
  assert.equal(plan.operation, "analyze_each_document");
  assert.equal(plan.scopeMode, "complete");
});

test("Chat V2 fallback preserves multiple requested capabilities", () => {
  const plan = fallbackExecutionPlan(
    'Count the phrase "peer feedback" across the repository and visualize the result'
  );
  assert.deepEqual(plan.operations, ["analyze_text", "visualize"]);
  assert.equal(plan.scopeMode, "complete");
});

test("Chat V2 does not force focused evidence questions into complete mode", () => {
  const plan = fallbackExecutionPlan("What did the studies report about learner anxiety?");
  assert.equal(plan.operation, "search_evidence");
  assert.equal(plan.scopeMode, "focused");
});

test("conversation language follows Thai dialogue despite embedded English terms", () => {
  assert.equal(
    inferConversationAnswerLanguage("ช่วย summarize methodology และ findings ให้หน่อย"),
    "Thai"
  );
  assert.equal(
    inferConversationAnswerLanguage("What does สมชาย report about feedback?"),
    "English"
  );
  assert.equal(
    inferConversationAnswerLanguage("Could you expand on that?", [
      { role: "user", content: "ช่วยสรุปผลการวิจัยในโฟลเดอร์นี้ให้หน่อย" },
      { role: "assistant", content: "ได้ครับ ผลการวิจัยหลักมีดังนี้" },
    ]),
    "Thai"
  );
});

test("reader-facing citations use paper titles instead of database ids", () => {
  const answer = formatPaperReferencesForReaders(
    "Feedback improved revision quality [Paper 101].",
    [{ paperId: "101", title: "Peer Feedback in EFL Writing", year: "2022" }]
  );
  assert.equal(answer, "Feedback improved revision quality **Peer Feedback in EFL Writing** (2022).");
  assert.doesNotMatch(answer, /Paper 101/);
});

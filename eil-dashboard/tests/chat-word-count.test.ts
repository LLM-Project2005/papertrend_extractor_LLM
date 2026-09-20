import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepositoryTermCounts,
  containsThaiScript,
  countTermInRepositoryText,
  tokenizeRepositoryText,
} from "../src/lib/repository-text";
import {
  contentSourceNote,
  countTermInRepositoryPaper,
  fallbackPromptPlan,
  formatPaperReferencesForReaders,
  legacyPlanForExecution,
  requestsRepositoryStatistics,
  requestsTotalWordCount,
  wordCountResult,
} from "../src/lib/repository-chat";
import type {
  PaperContentSource,
  RepositoryContext,
  RepositoryPaper,
  RepositoryPromptPlan,
} from "../src/lib/repository-chat";

function paper(
  overrides: Partial<RepositoryPaper> & { paperId: string; title: string; content: string }
): RepositoryPaper {
  const index = buildRepositoryTermCounts(overrides.content);
  return {
    runId: `run-${overrides.paperId}`,
    folderId: "folder-1",
    year: "2024",
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    contentHash: `hash-${overrides.paperId}`,
    contentSource: "full_text" as PaperContentSource,
    totalWords: index.totalWords,
    termCounts: index.termCounts,
    topics: new Map(),
    keywords: new Map(),
    ...overrides,
  };
}

function context(papers: RepositoryPaper[]): RepositoryContext {
  return {
    ownerUserId: "owner-1",
    projectId: "project-1",
    folderId: null,
    selectedRunIds: [],
    knowledgeScope: { kind: "project", projectId: "project-1" },
    scopeSnapshot: {
      kind: "project",
      label: "Repository test2",
      projectId: "project-1",
      projectName: "test2",
      folderId: null,
      folderName: null,
      selectedRunCount: 0,
      eligiblePaperCount: papers.length,
    },
    projects: [{ id: "project-1", name: "test2" }],
    scopeLabel: "Repository test2",
    versionHash: "version-1",
    summaryMarkdown: "",
    papers,
    topicCounts: [],
    keywordCounts: [],
    totalWords: papers.reduce((sum, item) => sum + item.totalWords, 0),
    runStats: {
      total: papers.length,
      succeeded: papers.length,
      queued: 0,
      processing: 0,
      failed: 0,
      canceled: 0,
      other: 0,
    },
  };
}

function plan(overrides: Partial<RepositoryPromptPlan> = {}): RepositoryPromptPlan {
  return {
    intent: "word_count",
    refinedQuestion: "how many words",
    terms: [],
    retrievalQueries: [],
    evidenceNeeds: [],
    answerLanguage: "English",
    retrievalMode: "exhaustive",
    needsChart: false,
    chartType: "bar",
    reason: "test",
    confidence: "high",
    source: "fallback",
    ...overrides,
  };
}

const THAI_SENTENCE = "การศึกษานี้มุ่งเน้นการใช้ภาษาอังกฤษเป็นภาษานานาชาติในห้องเรียนไทย";

test("Thai text segments into real words instead of vowel-mark fragments", () => {
  const tokens = tokenizeRepositoryText(THAI_SENTENCE);
  // The previous /[\p{L}\p{N}]+/ pattern split on Thai vowel marks (category Mn)
  // and produced fragments such as "การศ" and "กษาน".
  assert.ok(tokens.includes("ภาษา"), `expected the word ภาษา, got ${JSON.stringify(tokens)}`);
  assert.ok(tokens.includes("อังกฤษ"), `expected the word อังกฤษ, got ${JSON.stringify(tokens)}`);
  assert.ok(tokens.includes("การ"));
  assert.ok(!tokens.includes("การศ"), "must not emit the broken fragment การศ");
  assert.ok(!tokens.includes("กษาน"), "must not emit the broken fragment กษาน");
});

test("Thai word counting is repeat-sensitive", () => {
  // ภาษา appears twice in the sentence.
  assert.equal(countTermInRepositoryText(THAI_SENTENCE, "ภาษา"), 2);
  assert.equal(countTermInRepositoryText(THAI_SENTENCE, "อังกฤษ"), 1);
  assert.equal(countTermInRepositoryText(THAI_SENTENCE, "เยอรมัน"), 0);
});

test("English tokenization is unchanged by Thai support", () => {
  assert.deepEqual(
    tokenizeRepositoryText("This study examines teachers' state-of-the-art methods."),
    ["this", "study", "examines", "teachers", "state", "of", "the", "art", "methods"]
  );
  assert.deepEqual(tokenizeRepositoryText("Don't stop"), ["don't", "stop"]);
  assert.equal(countTermInRepositoryText("EIL and eil and EIL", "eil"), 3);
});

test("mixed Thai and English text counts both scripts", () => {
  const mixed = "การใช้ภาษาอังกฤษ English as an International Language ในประเทศไทย";
  const tokens = tokenizeRepositoryText(mixed);
  assert.ok(tokens.includes("english"));
  assert.ok(tokens.includes("international"));
  assert.ok(tokens.includes("ประเทศไทย"));
  assert.equal(countTermInRepositoryText(mixed, "ภาษา"), 1);
});

test("containsThaiScript identifies Thai documents", () => {
  assert.equal(containsThaiScript(THAI_SENTENCE), true);
  assert.equal(containsThaiScript("English only"), false);
});

test("multi-word Thai phrases require consecutive tokens", () => {
  assert.equal(countTermInRepositoryText(THAI_SENTENCE, "ภาษาอังกฤษ"), 1);
  assert.equal(countTermInRepositoryText(THAI_SENTENCE, "อังกฤษภาษา"), 0);
});

test("document-length questions route to word_count with no term", () => {
  for (const prompt of [
    "How many words are in this paper?",
    "what is the word count of each paper",
    "How long is the paper?",
    "total words in my documents",
  ]) {
    assert.equal(requestsTotalWordCount(prompt), true, `should detect: ${prompt}`);
    const result = fallbackPromptPlan(prompt, false);
    assert.equal(result.intent, "word_count", `intent for: ${prompt}`);
    assert.deepEqual(result.terms, [], `terms for: ${prompt}`);
    assert.equal(result.retrievalMode, "exhaustive", `mode for: ${prompt}`);
  }
});

test("Thai document-length questions route to word_count", () => {
  const result = fallbackPromptPlan("เอกสารนี้มีกี่คำ", false);
  assert.equal(result.intent, "word_count");
  assert.deepEqual(result.terms, []);
});

test("paper-count questions are not confused with word-count questions", () => {
  const papersPlan = fallbackPromptPlan("How many papers do I have?", false);
  assert.equal(papersPlan.intent, "repository_statistics");
  assert.equal(requestsTotalWordCount("How many papers do I have?"), false);

  const wordsPlan = fallbackPromptPlan("How many words do I have across my papers?", false);
  assert.equal(wordsPlan.intent, "word_count");
  assert.equal(requestsRepositoryStatistics("How many words are in this paper?"), false);
});

test("term-frequency questions still carry their term", () => {
  const result = fallbackPromptPlan('count the word "feedback"', false);
  assert.equal(result.intent, "word_count");
  assert.deepEqual(result.terms, ["feedback"]);
});

test("a length question reports per-paper totals instead of asking for a term", () => {
  const result = wordCountResult(
    context([
      paper({ paperId: "1", title: "Short paper", content: "one two three" }),
      paper({ paperId: "2", title: "Longer paper", content: "a b c d e f g h" }),
    ]),
    plan()
  );
  assert.doesNotMatch(result.answer, /Which exact word or phrase/);
  assert.match(result.answer, /Word count per paper/);
  assert.match(result.answer, /Short paper/);
  assert.match(result.answer, /Longer paper/);
  // 3 + 8 = 11 total words.
  assert.match(result.answer, /\*\*11\*\*/);
  assert.equal(result.citations.length, 2);
});

test("word totals are ordered longest first", () => {
  const result = wordCountResult(
    context([
      paper({ paperId: "1", title: "Short paper", content: "one two" }),
      paper({ paperId: "2", title: "Longest paper", content: "a b c d e" }),
    ]),
    plan()
  );
  assert.ok(
    result.answer.indexOf("Longest paper") < result.answer.indexOf("Short paper"),
    "longest paper should be listed first"
  );
});

test("counts disclose when only extracted sections are stored", () => {
  const partial = paper({ paperId: "1", title: "Sectioned paper", content: "abstract only text" });
  partial.contentSource = "extracted_sections";
  const result = wordCountResult(context([partial]), plan());
  assert.match(result.answer, /only extracted sections/i);
  assert.ok(
    (result.limitations ?? []).some((item) => /extracted sections/i.test(item)),
    "limitation must be reported to the caller"
  );
});

test("full-text corpora are not warned about", () => {
  const result = wordCountResult(
    context([paper({ paperId: "1", title: "Full paper", content: "one two three" })]),
    plan()
  );
  assert.match(result.answer, /full extracted document text/i);
  assert.deepEqual(result.limitations, []);
});

test("contentSourceNote reports empty papers honestly", () => {
  const blank = paper({ paperId: "1", title: "Blank", content: "" });
  blank.contentSource = "empty";
  assert.match(contentSourceNote([blank], false), /no stored text/i);
});

test("Thai answers keep the word-count table in Thai", () => {
  const result = wordCountResult(
    context([paper({ paperId: "1", title: "งานวิจัยไทย", content: THAI_SENTENCE })]),
    plan({ answerLanguage: "Thai" })
  );
  assert.match(result.answer, /จำนวนคำต่อเอกสาร/);
  assert.match(result.answer, /รวม/);
});

test("term counts over a paper use the shared tokenizer", () => {
  const thaiPaper = paper({ paperId: "1", title: "งานวิจัยไทย", content: THAI_SENTENCE });
  assert.equal(countTermInRepositoryPaper(thaiPaper, "ภาษา"), 2);
  assert.equal(countTermInRepositoryPaper(thaiPaper, "ภาษาอังกฤษ"), 1);
});

test("a charted length request produces a per-paper word chart", () => {
  const result = wordCountResult(
    context([
      paper({ paperId: "1", title: "Alpha", content: "one two three" }),
      paper({ paperId: "2", title: "Beta", content: "a b" }),
    ]),
    plan({ needsChart: true, chartType: "pie" })
  );
  assert.equal(result.charts.length, 1);
  const chart = result.charts[0];
  assert.equal(chart.metric, "word_count");
  // A pie chart cannot show per-paper magnitudes usefully here.
  assert.equal(chart.chartType, "bar");
  assert.deepEqual(chart.yKeys, ["words"]);
  assert.deepEqual(
    chart.data.map((row) => row.words),
    [3, 2]
  );
});

test("a length question ignores planner-supplied meta terms", () => {
  // Live regression: the V2 planner answered "how many words is each paper"
  // with terms ["word count", "words per paper"], so the term-frequency path
  // counted those literal phrases and reported 0 for every paper.
  const execution = {
    operation: "analyze_text" as const,
    operations: ["analyze_text" as const],
    scopeMode: "complete" as const,
    refinedQuestion: "How many words is each paper in this repository?",
    terms: ["word count", "words per paper"],
    retrievalQueries: [],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "table" as const,
    chartType: "bar" as const,
    reason: "planner",
    confidence: "high" as const,
    source: "llm" as const,
  };
  const converted = legacyPlanForExecution(
    execution,
    "How many words is each paper in this repository?"
  );
  assert.equal(converted.intent, "word_count");
  assert.deepEqual(converted.terms, [], "meta terms must be dropped for a length question");

  const result = wordCountResult(
    context([
      paper({ paperId: "1", title: "Alpha", content: "one two three four" }),
      paper({ paperId: "2", title: "Beta", content: "five six" }),
    ]),
    converted
  );
  assert.match(result.answer, /Word count per paper/);
  assert.match(result.answer, /\*\*6\*\*/, "must report the real total, not zero");
  assert.doesNotMatch(result.answer, /Exact word count/);
});

test("a genuine term question keeps its planner terms", () => {
  const execution = {
    operation: "analyze_text" as const,
    operations: ["analyze_text" as const],
    scopeMode: "complete" as const,
    refinedQuestion: 'How often does "feedback" appear?',
    terms: ["feedback"],
    retrievalQueries: [],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "table" as const,
    chartType: "bar" as const,
    reason: "planner",
    confidence: "high" as const,
    source: "llm" as const,
  };
  const converted = legacyPlanForExecution(execution, 'How often does "feedback" appear?');
  assert.deepEqual(converted.terms, ["feedback"]);
});

test("a Thai length question answers fully in Thai", () => {
  const execution = {
    operation: "analyze_text" as const,
    operations: ["analyze_text" as const],
    scopeMode: "complete" as const,
    refinedQuestion: "เอกสารในคลังนี้มีกี่คำ",
    terms: ["จำนวนคำทั้งหมด"],
    retrievalQueries: [],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "Thai",
    outputFormat: "table" as const,
    chartType: "bar" as const,
    reason: "planner",
    confidence: "high" as const,
    source: "llm" as const,
  };
  const converted = legacyPlanForExecution(execution, "เอกสารในคลังนี้มีกี่คำ");
  assert.deepEqual(converted.terms, []);
  const result = wordCountResult(
    context([paper({ paperId: "1", title: "งานวิจัย", content: "หนึ่ง สอง สาม" })]),
    converted
  );
  assert.match(result.answer, /จำนวนคำต่อเอกสาร/);
  assert.doesNotMatch(result.answer, /Exact word count/);
});

test("consecutive citations collapse into one readable group", () => {
  // Live regression: a corpus report cited five papers in a row and rendered
  // five full bold titles run together mid-paragraph.
  const papers = [
    { paperId: "1", title: "Alpha Study", year: "2016" },
    { paperId: "2", title: "Beta Study", year: "2017" },
    { paperId: "3", title: "Gamma Study", year: "Unknown" },
  ];
  const answer = formatPaperReferencesForReaders(
    "All three agree. [Paper 1] [Paper 2] [Paper 3]",
    papers
  );
  assert.equal(answer, "All three agree. (Alpha Study, 2016; Beta Study, 2017; Gamma Study)");
  assert.doesNotMatch(answer, /\*\*/, "citations should not be bolded inline");
});

test("long citation titles are shortened", () => {
  const long =
    "Rhythmical Patterns in the Readings of Thai Learners with High and Low English Language Experience";
  const answer = formatPaperReferencesForReaders("See [Paper 1].", [
    { paperId: "1", title: long, year: "2016" },
  ]);
  assert.ok(answer.length < long.length + 20, "long titles must be shortened");
  assert.match(answer, /…/, "shortened titles end with an ellipsis");
  assert.match(answer, /2016/);
});

test("a repeated citation is not listed twice", () => {
  const answer = formatPaperReferencesForReaders("Both say so. [Paper 1] [Paper 1]", [
    { paperId: "1", title: "Alpha Study", year: "2016" },
  ]);
  assert.equal(answer, "Both say so. (Alpha Study, 2016)");
});

test("unknown paper markers are left untouched", () => {
  const answer = formatPaperReferencesForReaders("See [Paper 99].", [
    { paperId: "1", title: "Alpha Study", year: "2016" },
  ]);
  assert.equal(answer, "See [Paper 99].");
});

test("an unknown year is omitted rather than printed as Unknown", () => {
  const answer = formatPaperReferencesForReaders("See [Paper 1].", [
    { paperId: "1", title: "Alpha Study", year: "Unknown" },
  ]);
  assert.equal(answer, "See (Alpha Study).");
  assert.doesNotMatch(answer, /Unknown/);
});

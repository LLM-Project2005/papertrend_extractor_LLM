import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import {
  refineRepositoryPrompt,
  type RepositoryContext,
  type RepositoryIntent,
  type RepositoryRetrievalMode,
} from "../src/lib/repository-chat";

loadEnvConfig(process.cwd());

const papers = Array.from({ length: 40 }, (_, index) => ({
  paperId: String(index + 1),
  runId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  folderId: "11111111-1111-4111-8111-111111111111",
  title: `EFL research paper ${index + 1}`,
  year: String(2000 + (index % 20)),
  abstract: "A study of feedback, language learning, and classroom methodology.",
  methods: index % 2 ? "Mixed methods" : "Quasi-experimental method",
  results: "The study reports learner outcomes.",
  conclusion: "The findings inform EFL teaching.",
  content: "A study of feedback, language learning, and classroom methodology.",
  contentHash: String(index + 1).padStart(64, "0"),
  totalWords: 1_000,
  termCounts: { feedback: 2 },
  topics: new Map([[index % 2 ? "Feedback" : "Methodology", 1]]),
  keywords: new Map([["EFL", 1]]),
}));

const context = {
  ownerUserId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  folderId: "11111111-1111-4111-8111-111111111111",
  selectedRunIds: [],
  scopeLabel: "EFL Repository",
  versionHash: "live-eval",
  summaryMarkdown: "# EFL Repository\n\n40 analyzed papers.",
  papers,
  topicCounts: [
    { label: "Feedback", paperCount: 20, mentions: 20 },
    { label: "Methodology", paperCount: 20, mentions: 20 },
  ],
  keywordCounts: [{ label: "EFL", paperCount: 40, mentions: 40 }],
  totalWords: 40_000,
  runStats: {
    total: 40,
    succeeded: 40,
    queued: 0,
    processing: 0,
    failed: 0,
    canceled: 0,
    other: 0,
  },
} as RepositoryContext;

const cases: Array<{
  prompt: string;
  intents: RepositoryIntent[];
  mode?: RepositoryRetrievalMode;
  chart?: boolean;
}> = [
  {
    prompt: "How many papers are in the attached repository?",
    intents: ["repository_statistics"],
    mode: "exhaustive",
    chart: false,
  },
  {
    prompt: "Summarize the main topics across the whole repository.",
    intents: ["topic_summary"],
    mode: "exhaustive",
    chart: false,
  },
  {
    prompt: "Compare the research methods used across these papers.",
    intents: ["repository_qa"],
    mode: "comparative",
    chart: false,
  },
  {
    prompt: "Count the exact word \"feedback\" across all papers.",
    intents: ["word_count"],
    mode: "exhaustive",
    chart: false,
  },
  {
    prompt: "Display the repository topics as a bar chart.",
    intents: ["topic_chart"],
    mode: "exhaustive",
    chart: true,
  },
  {
    prompt: "What evidence supports peer feedback improving writing?",
    intents: ["repository_qa"],
    mode: "focused",
    chart: false,
  },
];

async function main(): Promise<void> {
  for (const testCase of cases) {
    const plan = await refineRepositoryPrompt(testCase.prompt, context, undefined, false, []);
    assert.ok(
      testCase.intents.includes(plan.intent),
      `${testCase.prompt}: expected ${testCase.intents.join("/")}, received ${plan.intent}`
    );
    if (testCase.mode) {
      assert.equal(plan.retrievalMode, testCase.mode, testCase.prompt);
    }
    if (testCase.chart !== undefined) {
      assert.equal(plan.needsChart, testCase.chart, testCase.prompt);
    }
    console.log(JSON.stringify({ prompt: testCase.prompt, plan }));
  }
  console.log(JSON.stringify({ ok: true, cases: cases.length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

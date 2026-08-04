import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { planRepositoryExecution, type RepositoryContext, type RepositoryOperation } from "../src/lib/repository-chat";

loadEnvConfig(process.cwd());

const context = {
  ownerUserId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  folderId: null, selectedRunIds: [], scopeLabel: "Test repository", versionHash: "planner-live",
  summaryMarkdown: "# Test repository", papers: Array.from({ length: 40 }, (_, index) => ({
    paperId: String(index + 1), runId: crypto.randomUUID(), folderId: crypto.randomUUID(),
    title: `Paper ${index + 1}`, year: "2024", abstract: "", methods: "", results: "", conclusion: "",
    content: "", contentHash: String(index).padStart(64, "0"), totalWords: 0, termCounts: {}, topics: new Map(), keywords: new Map(),
  })), topicCounts: [], keywordCounts: [], totalWords: 0,
  runStats: { total: 40, succeeded: 40, queued: 0, processing: 0, failed: 0, canceled: 0, other: 0 },
} satisfies RepositoryContext;

const cases: Array<[string, RepositoryOperation, "complete" | "focused"]> = [
  ["List me all the papers name", "list_documents", "complete"],
  ["Explain each file in this repository", "analyze_each_document", "complete"],
  ["How many papers are here?", "inspect_scope", "complete"],
  ["Find the major methodological gaps across the corpus", "aggregate_corpus", "complete"],
  ["What evidence links feedback with writing improvement?", "search_evidence", "focused"],
  ["Count the exact phrase peer feedback in every paper", "analyze_text", "complete"],
  ["Show topic coverage as a bar chart", "visualize", "complete"],
  ["อธิบายงานวิจัยทุกเรื่องในคลังนี้", "analyze_each_document", "complete"],
];

async function main() {
  for (const [prompt, operation, scopeMode] of cases) {
    const plan = await planRepositoryExecution({
      ownerUserId: context.ownerUserId,
      projectId: context.projectId,
      prompt,
      model: "google/gemini-3.1-flash-lite",
    }, context);
    assert.equal(plan.operation, operation, prompt);
    assert.equal(plan.scopeMode, scopeMode, prompt);
    console.log(JSON.stringify({ prompt, operation: plan.operation, scopeMode: plan.scopeMode, source: plan.source }));
  }
  console.log(JSON.stringify({ ok: true, cases: cases.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

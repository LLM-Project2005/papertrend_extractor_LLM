import assert from "node:assert/strict";
import test from "node:test";
import { shouldQueueRepositoryChat } from "../src/lib/repository-chat-routing";
import type { RepositoryExecutionPlan, RepositoryOperation } from "../src/lib/repository-chat";

function plan(operation: RepositoryOperation, options: Partial<RepositoryExecutionPlan> = {}): RepositoryExecutionPlan {
  return {
    operation,
    operations: [operation],
    scopeMode: "focused",
    refinedQuestion: "test",
    terms: [],
    retrievalQueries: [],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "prose",
    chartType: "bar",
    reason: "test",
    confidence: "high",
    source: "fallback",
    ...options,
  };
}

function queued(execution: RepositoryExecutionPlan, overrides: Partial<Parameters<typeof shouldQueueRepositoryChat>[0]> = {}) {
  return shouldQueueRepositoryChat({
    execution,
    paperCount: 40,
    allowWeb: false,
    bypassAsyncJob: false,
    asyncPaperThreshold: 80,
    ...overrides,
  });
}

test("fast deterministic repository operations remain synchronous", () => {
  for (const operation of ["inspect_scope", "list_documents", "analyze_text", "visualize"] as const) {
    assert.equal(queued(plan(operation)), false, operation);
  }
  assert.equal(queued(plan("search_evidence")), false);
});

test("corpus synthesis, web augmentation, and heavy compound plans are durable", () => {
  assert.equal(queued(plan("aggregate_corpus", { scopeMode: "complete" })), true);
  assert.equal(queued(plan("search_evidence"), { allowWeb: true }), true);
  assert.equal(queued(plan("inspect_scope", {
    operations: ["inspect_scope", "search_evidence"],
  })), true);
  assert.equal(queued(plan("search_evidence", { scopeMode: "complete" })), true);
});

test("paper-by-paper analysis queues only above the configured threshold", () => {
  const execution = plan("analyze_each_document", { scopeMode: "complete" });
  assert.equal(queued(execution, { paperCount: 80 }), false);
  assert.equal(queued(plan("analyze_each_document"), { paperCount: 80 }), false);
  assert.equal(queued(plan("analyze_each_document"), { paperCount: 81 }), true);
});

test("processor bypass prevents recursive job creation", () => {
  assert.equal(queued(plan("aggregate_corpus"), { bypassAsyncJob: true }), false);
  assert.equal(queued(plan("search_evidence"), { allowWeb: true, bypassAsyncJob: true }), false);
});

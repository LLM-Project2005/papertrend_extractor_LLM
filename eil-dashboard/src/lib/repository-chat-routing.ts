import type { RepositoryExecutionPlan } from "@/lib/repository-chat";

interface RepositoryAsyncRoutingInput {
  execution: RepositoryExecutionPlan;
  paperCount: number;
  allowWeb: boolean;
  bypassAsyncJob: boolean;
  asyncPaperThreshold: number;
}

const MODEL_HEAVY_OPERATIONS = new Set([
  "analyze_each_document",
  "aggregate_corpus",
  "search_evidence",
]);

export function shouldQueueRepositoryChat({
  execution,
  paperCount,
  allowWeb,
  bypassAsyncJob,
  asyncPaperThreshold,
}: RepositoryAsyncRoutingInput): boolean {
  if (bypassAsyncJob) return false;
  if (allowWeb) return true;
  if (execution.operation === "aggregate_corpus") return true;
  if (
    execution.operation === "analyze_each_document" &&
    paperCount > asyncPaperThreshold
  ) {
    return true;
  }

  const modelHeavyCount = execution.operations.filter((operation) =>
    MODEL_HEAVY_OPERATIONS.has(operation)
  ).length;
  if (execution.operations.length > 1 && modelHeavyCount > 0) return true;

  return (
    execution.scopeMode === "complete" &&
    execution.operations.includes("search_evidence")
  );
}

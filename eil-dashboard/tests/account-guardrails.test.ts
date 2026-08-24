import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  recordAiTokenUsage,
  withAiTokenUsageTracking,
} from "../src/lib/ai-token-usage";

const root = process.cwd();

test("upload entry points support batches and send SHA-256 fingerprints", () => {
  const modal = readFileSync(
    join(root, "src/components/workspace/AnalyzeFlowModal.tsx"),
    "utf8"
  );
  const library = readFileSync(
    join(root, "src/components/admin/AdminImportClient.tsx"),
    "utf8"
  );
  for (const source of [modal, library]) {
    assert.match(source, /fingerprintFiles/);
    assert.match(source, /sha256: fingerprints\[fileIndex\]/);
    assert.match(source, /multiple/);
    assert.match(source, /10 \* 1024 \* 1024/);
    assert.doesNotMatch(source, /For beta stability, upload one PDF at a time/);
  }
});

test("Cloud SQL upload preparation serializes quota and duplicate checks", () => {
  const source = readFileSync(
    join(root, "src/lib/cloudsql/ingestion-repository.ts"),
    "utf8"
  );
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /MAX_PAPERS_PER_ACCOUNT/);
  assert.match(source, /file_fingerprints/);
  assert.match(source, /ON CONFLICT \(owner_user_id, sha256\)/);
  assert.match(source, /r\.status = 'succeeded'/);
  assert.match(source, /pc\.ingestion_run_id = r\.id/);
  assert.match(source, /status = 'succeeded'/);
  assert.doesNotMatch(source, /status NOT IN \('failed', 'canceled'\)/);
  assert.match(source, /The same PDF was selected more than once/);
});

test("upload finalization tolerates Cloud Run cold starts and persists trigger failures", () => {
  const trigger = readFileSync(join(root, "src/lib/worker-trigger.ts"), "utf8");
  const finalize = readFileSync(
    join(root, "src/app/api/admin/import/finalize/route.ts"),
    "utf8"
  );
  assert.match(trigger, /WORKER_REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(trigger, /worker_request_timeout/);
  assert.match(trigger, /catch \(error\)/);
  assert.match(finalize, /buildTriggerExceptionResult/);
  assert.match(finalize, /queueStart = buildTriggerExceptionResult\(triggerError\)/);
});

test("chat uses account token accounting and the approved model pair", () => {
  const route = readFileSync(join(root, "src/app/api/chat/route.ts"), "utf8");
  const openai = readFileSync(join(root, "src/lib/openai.ts"), "utf8");
  const guards = readFileSync(join(root, "src/lib/security-guards.ts"), "utf8");
  assert.match(route, /openai\/gpt-5\.6-luna-20260709/);
  assert.match(route, /google\/gemini-3\.7-flash/);
  assert.match(route, /withAiTokenUsageTracking/);
  assert.match(openai, /recordAiTokenUsage\(payload\.usage\)/);
  assert.match(guards, /AI usage events|metadata->>'metric'='tokens'|metric: "tokens"/);
});

test("token accounting aggregates every model call in one request context", async () => {
  await withAiTokenUsageTracking(async (usage) => {
    recordAiTokenUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });
    recordAiTokenUsage({ input_tokens: 50, output_tokens: 20 });
    assert.deepEqual(usage, {
      promptTokens: 170,
      completionTokens: 50,
      totalTokens: 220,
      calls: 2,
    });
  });
});

test("Library starts from the account repository index", () => {
  const source = readFileSync(
    join(root, "src/components/admin/AdminImportClient.tsx"),
    "utf8"
  );
  assert.match(source, /allProjects\s*\.filter/);
  assert.match(source, /setLibraryProjectId\(project\.id\)/);
  assert.match(source, /\/api\/workspace\/library\?includeTrashed=/);
  assert.match(source, /Repositories are the top-level containers for this account/);
});

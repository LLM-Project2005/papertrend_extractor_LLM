import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd());
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("repository jobs persist one placeholder and replace it atomically", () => {
  const jobs = read("src/lib/repository-chat-jobs.ts");
  assert.match(jobs, /stableUuid\(`papertrend:repository-chat:/);
  assert.match(jobs, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(jobs, /assistantMessageId/);
  assert.match(jobs, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(jobs, /status IN \('queued','processing'\)/);
  assert.match(jobs, /updated_at < now\(\) - interval '5 minutes'/);
  assert.match(jobs, /heartbeatRepositoryChatJob/);
  assert.match(jobs, /interval '30 days'/);
});

test("repository tasks bypass Firebase and allow long direct callbacks", () => {
  const jobs = read("src/lib/repository-chat-jobs.ts");
  const origin = read("src/lib/public-request-origin.ts");
  assert.match(jobs, /dispatchDeadline: "1800s"/);
  assert.match(jobs, /repository-chat-\$\{id\}/);
  assert.match(origin, /process\.env\.APP_PUBLIC_URL/);
  assert.match(read("../cloudbuild.web.production.yaml"), /--timeout[\s\S]{0,30}"1800"/);
  assert.match(read("../cloudbuild.web.cloudsql.pilot.yaml"), /--timeout[\s\S]{0,30}"1800"/);
});

test("client polling resumes persisted jobs without appending duplicate answers", () => {
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /message\.metadata\?\.repositoryJobId/);
  assert.match(client, /repositoryJobPollsRef/);
  assert.match(client, /await loadThreadDetail\(threadId\)/);
  assert.doesNotMatch(client, /setMessages\(\(current\) => \[\.\.\.current, localMessage\(/);
});

test("planner calls are bounded while final generation remains unshortened", () => {
  const chat = read("src/lib/repository-chat.ts");
  const openai = read("src/lib/openai.ts");
  assert.match(chat, /CHAT_EXECUTION_PLAN[\s\S]{0,120}timeoutMs: 12_000/);
  assert.match(chat, /CHAT_EXECUTION_PLAN_REPAIR[\s\S]{0,120}timeoutMs: 12_000/);
  assert.match(openai, /AbortSignal\.timeout/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("chat history and composer stay within the current repository", () => {
  const client = readFileSync(join(root, "src/components/chat/ChatClient.tsx"), "utf8");
  const threadsRoute = readFileSync(join(root, "src/app/api/chat/threads/route.ts"), "utf8");
  const repository = readFileSync(join(root, "src/lib/chat-repository.ts"), "utf8");

  assert.match(client, /useState<string>\("all"\)/);
  assert.doesNotMatch(client, /setChatScopeFolderId\("all-projects"\)/);
  assert.match(client, /api\/chat\/threads\?projectId=/);
  assert.match(client, /menuView === "scope"/);
  assert.match(client, /Entire repository/);
  assert.match(threadsRoute, /searchParams\.get\("projectId"\)/);
  assert.match(repository, /metadata #>> '\{knowledgeScope,projectId\}'/);
});

test("grounded answers receive one bounded intent and evidence review", () => {
  const source = readFileSync(join(root, "src/lib/repository-chat.ts"), "utf8");
  assert.match(source, /Act as a bounded final-answer editor/);
  assert.match(source, /answersIntent/);
  assert.match(source, /completeForRequest/);
  assert.match(source, /languageMatched/);
  assert.doesNotMatch(source, /while\s*\([^)]*checkFaithfulness/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizeChatFolderId } from "../src/lib/chat-store";

const root = process.cwd();

test("chat history is account-wide while message scope is repository or selected papers", () => {
  const client = readFileSync(join(root, "src/components/chat/ChatClient.tsx"), "utf8");
  const chatRoute = readFileSync(join(root, "src/app/api/chat/route.ts"), "utf8");
  const threadRoute = readFileSync(
    join(root, "src/app/api/chat/threads/[threadId]/route.ts"),
    "utf8"
  );

  assert.match(client, /fetch\("\/api\/chat\/threads"/);
  assert.doesNotMatch(client, /api\/chat\/threads\?projectId=/);
  assert.match(client, /allProjects\.map/);
  assert.doesNotMatch(client, /projectFolders/);
  assert.doesNotMatch(client, /Show folders in/);
  assert.match(client, /menuView === "scope"/);
  assert.match(client, /All repositories/);
  assert.match(client, /return \{ kind: "all_projects" \}/);
  assert.match(chatRoute, /scopeSnapshot: preliminaryScopeSnapshot/);
  assert.doesNotMatch(chatRoute, /This chat belongs to a different repository/);
  assert.doesNotMatch(threadRoute, /This chat belongs to a different repository/);
});

test("grounded answers receive one bounded intent and evidence review", () => {
  const source = readFileSync(join(root, "src/lib/repository-chat.ts"), "utf8");
  assert.match(source, /Act as a bounded final-answer editor/);
  assert.match(source, /answersIntent/);
  assert.match(source, /completeForRequest/);
  assert.match(source, /languageMatched/);
  assert.doesNotMatch(source, /while\s*\([^)]*checkFaithfulness/);
});

test("Cloud SQL chat writes normalize repository-wide folder scope", () => {
  assert.equal(normalizeChatFolderId(undefined), null);
  assert.equal(normalizeChatFolderId(null), null);
  assert.equal(normalizeChatFolderId("all"), null);
  assert.equal(
    normalizeChatFolderId("d5e51f69-1888-4037-9711-c37e61b9a408"),
    "d5e51f69-1888-4037-9711-c37e61b9a408"
  );

  const repository = readFileSync(join(root, "src/lib/chat-repository.ts"), "utf8");
  assert.doesNotMatch(repository, /input\.folderId \|\| null/);
});

test("Deep Research resolves selected runs through canonical paper content", () => {
  const route = readFileSync(join(root, "src/app/api/chat/route.ts"), "utf8");
  assert.match(route, /c\.ingestion_run_id=ANY/);
  assert.match(route, /COALESCE\(c\.folder_id,p\.folder_id\)/);
  assert.doesNotMatch(route, /p\.ingestion_run_id/);
  assert.match(route, /chat_request_failed/);
});

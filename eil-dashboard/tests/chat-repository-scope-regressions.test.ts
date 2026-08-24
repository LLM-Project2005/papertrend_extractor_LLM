import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("chat history is account-wide while each message keeps an explicit repository scope", () => {
  const client = readFileSync(join(root, "src/components/chat/ChatClient.tsx"), "utf8");
  const chatRoute = readFileSync(join(root, "src/app/api/chat/route.ts"), "utf8");
  const threadRoute = readFileSync(
    join(root, "src/app/api/chat/threads/[threadId]/route.ts"),
    "utf8"
  );

  assert.match(client, /fetch\("\/api\/chat\/threads"/);
  assert.doesNotMatch(client, /api\/chat\/threads\?projectId=/);
  assert.match(client, /allProjects\.map/);
  assert.match(client, /allFolders\.filter/);
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

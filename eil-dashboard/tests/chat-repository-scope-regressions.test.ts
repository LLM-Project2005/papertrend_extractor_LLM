/*
 * Chat scope at the route, run rather than read (docs/32, long-term health): a
 * conversation belongs to the account, each question carries its own scope,
 * and the route reads no papers itself. The chat routes run as written against
 * PGlite under the app's role (tests/support/route-harness.ts); only the
 * repository chat answers from a script (stub-chatscope-repository-chat.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import type { RepositoryChatInput, RepositoryChatResult } from "../src/lib/repository-chat";
import { params, routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-chatscope-repository-chat.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT_A = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_B = "00000000-0000-4000-8000-0000000000a2";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a9";
const FOLDER_B = "00000000-0000-4000-8000-0000000000f2";
const RUN_B = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52";

type Script = (input: RepositoryChatInput) => Promise<Partial<RepositoryChatResult>>;

async function workspace() {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT_A}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Writing', '{}'::jsonb, 2, 'test', now()),
      ('${PROJECT_B}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Assessment', '{}'::jsonb, 2, 'test', now()),
      ('${OTHER_PROJECT}', '00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Theirs', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER_B}', '${OWNER}', 'Rubrics', '${PROJECT_B}');
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload)
      VALUES ('${RUN_B}', '${OWNER}', '${FOLDER_B}', 'upload', 'succeeded', 'rubric.pdf', '{}'::jsonb);
  `);
  const { fallbackPromptPlan } = await import("../src/lib/repository-chat");
  const asked: RepositoryChatInput[] = [];
  let script: Script = async () => ({});
  globalThis.__chatScopeRepositoryChat = async (input) => {
    asked.push(input);
    const scope = input.knowledgeScope ?? { kind: "all_projects" as const };
    return {
      handled: true,
      answer: `An answer about ${scope.kind}.`,
      citations: [],
      charts: [],
      limitations: [],
      plan: fallbackPromptPlan(input.prompt, false),
      scopeSnapshot: {
        kind: scope.kind,
        label: `Scope of ${scope.kind}`,
        projectId: scope.projectId ?? null,
        projectName: null,
        folderId: scope.folderId ?? null,
        folderName: null,
        selectedRunCount: scope.runIds?.length ?? 0,
        eligiblePaperCount: 1,
      },
      diagnostics: { projectId: scope.projectId ?? null, folderId: null, selectedRunCount: 0, paperCount: 1, versionHash: "v1", scopeLabel: "Scope" },
      ...(await script(input)),
    };
  };
  const { POST } = await import("../src/app/api/chat/route");
  const ask = (headers: Record<string, string>, body: Record<string, unknown>) => POST(harness.request("/api/chat", { headers, body }));
  return { ...harness, owner, other, asked, ask, answerWith: (next: Script) => void (script = next) };
}

interface MessageRow {
  role: string;
  folder_id: string | null;
  metadata: { knowledgeScope?: unknown; scopeSnapshot?: { kind?: string; label?: string } };
}

test("a conversation belongs to the account: each question keeps its own scope, across repositories", async () => {
  const { db, owner, asked, ask, answerWith, request } = await workspace();
  const savedFirst: Array<Record<string, unknown>> = [];
  answerWith(async (input) => {
    // The question is saved, with the scope it was asked in, before it is answered.
    const row = await db.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM workspace_messages WHERE id = $1`, [input.sourceMessageId]);
    savedFirst.push(row.rows[0].metadata);
    return {};
  });

  const first = await ask(owner, { message: "Which papers study peer feedback?", knowledgeScope: { kind: "project", projectId: PROJECT_A } });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.mode, "grounded");
  const threadId = firstBody.thread.id as string;
  assert.deepEqual(savedFirst[0].knowledgeScope, { kind: "project", projectId: PROJECT_A });
  assert.deepEqual(savedFirst[0].scopeSnapshot, {
    kind: "project",
    label: "Current project",
    projectId: PROJECT_A,
    projectName: null,
    folderId: null,
    folderName: null,
    selectedRunCount: 0,
    eligiblePaperCount: 0,
  });

  // The same conversation, now about one paper in another repository: answered, not refused.
  const second = await ask(owner, {
    message: "And what does this rubric paper find?",
    threadId,
    knowledgeScope: { kind: "selected_papers", projectId: PROJECT_B, runIds: [RUN_B] },
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.mode, "grounded");
  assert.equal(secondBody.thread.id, threadId);
  assert.deepEqual(asked.map((input) => [input.threadId, input.projectId, input.knowledgeScope]), [
    [threadId, PROJECT_A, { kind: "project", projectId: PROJECT_A }],
    [threadId, PROJECT_B, { kind: "selected_papers", projectId: PROJECT_B, runIds: [RUN_B] }],
  ]);

  const thread = await db.query<{ folder_id: string | null }>(`SELECT folder_id FROM workspace_threads WHERE id = $1`, [threadId]);
  assert.equal(thread.rows[0].folder_id, null, "the conversation itself has no repository");
  const rows = (await db.query<MessageRow>(`SELECT role, folder_id, metadata FROM workspace_messages WHERE thread_id = $1 ORDER BY created_at`, [threadId])).rows;
  assert.deepEqual(rows.map((row) => [row.role, row.metadata.scopeSnapshot?.label]), [
    ["user", "Scope of project"],
    ["assistant", "Scope of project"],
    ["user", "Scope of selected_papers"],
    ["assistant", "Scope of selected_papers"],
  ], "each message keeps the scope its answer was given in");

  const { GET } = await import("../src/app/api/chat/threads/[threadId]/route");
  const detail = await GET(request(`/api/chat/threads/${threadId}`, { headers: owner }), params({ threadId }));
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).messages.length, 4);
});

test("the conversation list is the whole account's, a page at a time, never filtered by repository", async () => {
  const { owner, other, ask, request } = await workspace();
  const opened: string[] = [];
  for (const knowledgeScope of [{ kind: "project", projectId: PROJECT_A }, { kind: "project", projectId: PROJECT_B }, undefined]) {
    const body = await (await ask(owner, { message: "What do these papers say about feedback?", knowledgeScope })).json();
    opened.unshift(body.thread.id);
  }
  await ask(other, { message: "Mine?", knowledgeScope: { kind: "project", projectId: OTHER_PROJECT } });

  const { GET } = await import("../src/app/api/chat/threads/route");
  const list = async (query: string) => {
    const response = await GET(request(`/api/chat/threads${query}`, { headers: owner }));
    assert.equal(response.status, 200);
    return (await response.json()) as { threads: Array<{ id: string; updated_at: string }>; hasMore: boolean };
  };
  const all = await list(`?projectId=${PROJECT_A}`);
  assert.deepEqual(all.threads.map((thread) => thread.id), opened, "newest first, every repository, and no one else's");
  assert.equal(all.hasMore, false);

  const page = await list("?limit=2");
  assert.deepEqual(page.threads.map((thread) => thread.id), opened.slice(0, 2));
  assert.equal(page.hasMore, true);
  const rest = await list(`?limit=2&before=${encodeURIComponent(page.threads[1].updated_at)}`);
  assert.deepEqual(rest.threads.map((thread) => thread.id), opened.slice(2));
  assert.equal(rest.hasMore, false);
});

test("Cloud SQL chat writes normalize repository-wide folder scope", async () => {
  const { normalizeChatFolderId } = await import("../src/lib/chat-store");
  assert.equal(normalizeChatFolderId(undefined), null);
  assert.equal(normalizeChatFolderId(null), null);
  assert.equal(normalizeChatFolderId("all"), null);
  assert.equal(
    normalizeChatFolderId("d5e51f69-1888-4037-9711-c37e61b9a408"),
    "d5e51f69-1888-4037-9711-c37e61b9a408"
  );

  const { db, owner, asked, ask } = await workspace();
  const { getChatRepository } = await import("../src/lib/chat-repository");
  const repository = getChatRepository();
  const thread = await repository.createThread({ ownerUserId: OWNER, mode: "normal", title: "Folders" });
  const everywhere = await repository.appendMessage({ threadId: thread.id, ownerUserId: OWNER, folderId: "all", role: "user", content: "Across everything?" });
  const inFolder = await repository.appendMessage({ threadId: thread.id, ownerUserId: OWNER, folderId: FOLDER_B, role: "user", content: "In rubrics?" });
  const stored = await db.query<{ id: string; folder_id: string | null }>(`SELECT id, folder_id FROM workspace_messages WHERE thread_id = $1`, [thread.id]);
  assert.deepEqual(
    Object.fromEntries(stored.rows.map((row) => [row.id, row.folder_id])),
    { [everywhere.id]: null, [inFolder.id]: FOLDER_B },
    "'all' is stored as no folder rather than refused"
  );

  const response = await ask(owner, { message: "Across everything?", projectId: "all", folderId: "all" });
  assert.equal(response.status, 200);
  assert.deepEqual(asked.at(-1)?.knowledgeScope, { kind: "all_projects" });
  const { thread: answered } = await response.json();
  const folders = await db.query<{ folder_id: string | null }>(`SELECT folder_id FROM workspace_messages WHERE thread_id = $1`, [answered.id]);
  assert.deepEqual(folders.rows.map((row) => row.folder_id), [null, null]);
});

test("the chat route reads no papers itself: with every paper table closed to it, it still answers, charts included", async () => {
  // Its own paper SQL belonged to the legacy chart and research paths, removed
  // (docs/32, long-term health): the repository chat and deep research v2 read papers.
  const { db, owner, asked, ask, answerWith } = await workspace();
  await db.exec(`
    REVOKE SELECT ON papers, papers_full, paper_content, paper_keywords, paper_term_index,
      paper_retrieval_documents, paper_retrieval_chunks, ingestion_runs FROM papertrend_app;
  `);
  const { withCloudSqlOwnerTransaction } = await import("../src/lib/cloudsql/client");
  answerWith(async () => {
    await assert.rejects(withCloudSqlOwnerTransaction(OWNER, (client) => client.query("SELECT 1 FROM papers")), /permission denied/);
    return {};
  });
  for (const body of [
    { message: "How many papers per year?", toolMode: "chart", chartRequest: { metric: "papers_per_year", chartType: "bar" }, knowledgeScope: { kind: "project", projectId: PROJECT_B } },
    { message: "What does the rubric paper find?", knowledgeScope: { kind: "selected_papers", projectId: PROJECT_B, runIds: [RUN_B] } },
  ]) {
    const response = await ask(owner, body);
    assert.equal(response.status, 200, body.message);
    const payload = await response.json();
    assert.equal(payload.mode, "grounded", body.message);
    assert.match(payload.answer, /^An answer about /);
  }
  assert.deepEqual(asked.map((input) => input.forceChart), [true, false], "the chart request went to the repository chat");
});

test("an unexpected failure is logged by name and answered plainly, and no one else's conversation is reachable", async () => {
  const { db, owner, other, asked, ask } = await workspace();
  const theirs = (await (await ask(other, { message: "Mine?" })).json()).thread.id as string;
  const errors = mock.method(console, "error", () => undefined);
  try {
    for (const threadId of [theirs, "00000000-0000-4000-8000-0000000000ee"]) {
      const response = await ask(owner, { message: "Can I add to this?", threadId });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Chat request failed." }, "the reader is not shown the raw error");
    }
    const logged = errors.mock.calls.filter((call) => call.arguments[0] === "chat_request_failed");
    assert.deepEqual(logged.map((call) => call.arguments[1]), [
      { name: "Error", message: "Chat thread not found." },
      { name: "Error", message: "Chat thread not found." },
    ]);
  } finally {
    errors.mock.restore();
  }
  assert.equal(asked.length, 1, "only their own question reached the repository chat");
  const count = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM workspace_messages WHERE thread_id = $1`, [theirs]);
  assert.equal(count.rows[0].count, 2, "nothing was added to their conversation");
});

test("the chat page lists the account's conversations and offers every repository as a scope", () => {
  // ChatClient needs the auth and workspace providers and a browser to load its
  // conversations, so its requests and scope menu are read here, not run.
  const client = readFileSync(join(process.cwd(), "src/components/chat/ChatClient.tsx"), "utf8");
  assert.match(client, /fetch\("\/api\/chat\/threads(\?limit=\d+)?"/);
  assert.doesNotMatch(client, /api\/chat\/threads\?projectId=/);
  assert.match(client, /allProjects\.map/);
  assert.doesNotMatch(client, /projectFolders/);
  assert.doesNotMatch(client, /Show folders in/);
  assert.match(client, /menuView === "scope"/);
  assert.match(client, /All repositories/);
  assert.match(client, /return \{ kind: "all_projects" \}/);
});

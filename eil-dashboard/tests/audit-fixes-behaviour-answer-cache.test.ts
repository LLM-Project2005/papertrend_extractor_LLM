/*
 * The chat's answer cache (docs/32, 2.11, CHAT-5), run rather than read:
 * runRepositoryChat answers questions about papers in PGlite under the app's
 * role (tests/support/route-harness.ts), with the model answering from a
 * script by task name (stub-auditfix-openai.ts). Nothing leaves the process.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryChatInput, RepositoryExecutionPlan } from "../src/lib/repository-chat";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/openai.ts", new URL("./support/stub-auditfix-openai.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const PAPERS = [
  { run: "11111111-1111-4111-8111-111111111111", title: "Peer feedback in second-language writing", year: "2021" },
  { run: "22222222-2222-4222-8222-222222222222", title: "Mobile apps for vocabulary learning", year: "2022" },
];
const LIST = "List all the papers in this repository";
const GEMINI = "google/gemini-3.7-flash";
const OTHER_MODEL = "openai/gpt-5.5-mini";

globalThis.fetch = (async (input: string | URL | Request) => {
  throw new Error(`A test made an unexpected request: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;

async function repository() {
  const harness = await routeHarness();
  await harness.signIn(OWNER);
  const { paperIdFromRunId } = await import("../src/lib/paper-id");
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Language learning', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Studies', '${PROJECT}');
  `);
  for (const paper of PAPERS) {
    const paperId = paperIdFromRunId(paper.run);
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload)
       VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb)`,
      [paper.run, OWNER, FOLDER]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [paperId, OWNER, FOLDER, paper.year, paper.title]);
    await harness.db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, body, ingestion_run_id) VALUES ($1, $2, $3, $4, $5)`,
      [paperId, OWNER, FOLDER, `${paper.title}. The study reports its findings.`, paper.run]
    );
  }
  const { runRepositoryChat } = await import("../src/lib/repository-chat");
  (await import("../src/lib/answer-cache")).resetAnswerCache();
  globalThis.__auditfixModelCalls = [];
  globalThis.__auditfixModelReplies = {};
  const ask = async (prompt: string, extra: Partial<RepositoryChatInput> = {}) => {
    const { info } = console;
    console.info = () => undefined;
    try {
      return await runRepositoryChat({ ownerUserId: OWNER, prompt, knowledgeScope: { kind: "project", projectId: PROJECT }, projectId: PROJECT, ...extra });
    } finally {
      console.info = info;
    }
  };
  return { ask };
}

test("a cached answer is served only for the same model and the same web setting", async () => {
  const { ask } = await repository();
  const first = await ask(LIST, { model: GEMINI });
  assert.notEqual(first.diagnostics.cached, true);
  assert.deepEqual(first.limitations ?? [], [], "a clean answer, so it is kept");
  assert.match(first.answer, /Peer feedback in second-language writing/);

  assert.equal((await ask(LIST, { model: GEMINI })).diagnostics.cached, true, "the same question, model and setting");
  assert.notEqual((await ask(LIST, { model: OTHER_MODEL })).diagnostics.cached, true, "another model's answer is not this one's");
  assert.notEqual((await ask(LIST, { model: GEMINI, allowWeb: true })).diagnostics.cached, true, "nor one asked with web search");
  assert.notEqual((await ask(LIST)).diagnostics.cached, true, "nor one with the model chosen automatically");
  assert.equal((await ask(LIST, { model: GEMINI })).diagnostics.cached, true, "the first answer is still kept");
});

test("an answer with a limitation is written again rather than served from the cache", async () => {
  const { ask } = await repository();
  globalThis.__auditfixModelReplies = { CHAT_CONVERSE: "Hello! Ask me about the papers in this repository." };
  const converse: RepositoryExecutionPlan = {
    operation: "converse",
    operations: ["converse"],
    scopeMode: "focused",
    refinedQuestion: "Hello there",
    terms: [],
    retrievalQueries: [],
    evidenceNeeds: [],
    requestedFields: [],
    answerLanguage: "English",
    outputFormat: "prose",
    chartType: "bar",
    reason: "test",
    confidence: "high",
    source: "llm",
  };
  const first = await ask("Hello there", { executionPlan: converse });
  assert.ok((first.limitations ?? []).length > 0, "the answer carries a limitation");
  globalThis.__auditfixModelCalls = [];
  const again = await ask("Hello there", { executionPlan: converse });
  assert.notEqual(again.diagnostics.cached, true);
  assert.deepEqual(globalThis.__auditfixModelCalls, ["CHAT_CONVERSE"], "written again by the model");
});

test("a cached answer is a copy: what one caller adds to its answer is not served to the next", async () => {
  const { ask } = await repository();
  const first = await ask(LIST);
  assert.ok(first.execution, "the answer says how it was reached");
  const question = first.execution.refinedQuestion;
  const citations = structuredClone(first.citations);
  // What the chat job does with a web step: more sources, a note, a new question.
  first.execution.refinedQuestion = "changed by the first caller";
  first.citations.push({ ...(first.citations[0] ?? {}), title: "A web page", href: "https://example.org" } as never);
  first.limitations?.push("Web search found nothing new.");

  const second = await ask(LIST);
  assert.equal(second.diagnostics.cached, true);
  assert.equal(second.execution?.refinedQuestion, question);
  assert.deepEqual(second.citations, citations);
  assert.deepEqual(second.limitations, []);

  second.execution!.refinedQuestion = "changed by the second caller";
  second.citations.push({ title: "Another web page" } as never);
  const third = await ask(LIST);
  assert.equal(third.execution?.refinedQuestion, question);
  assert.deepEqual(third.citations, citations);
});

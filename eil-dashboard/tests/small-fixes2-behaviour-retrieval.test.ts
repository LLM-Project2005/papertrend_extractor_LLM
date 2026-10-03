/*
 * A question's repository load and retrieval, run (docs/32, long-term health):
 * runRepositoryChat and loadRepositoryContext as written, against twelve
 * papers in PGlite under the app's role (tests/support/route-harness.ts). The
 * model answers from a script, by task name (stub-chatscope-openai.ts); the
 * ranking, the search by meaning and the word index are the real ones, which
 * also note when they run (stub-smallfix2-retrieval.ts,
 * stub-smallfix2-repository-text.ts).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RepositoryExecutionPlan } from "../src/lib/repository-chat";
import { isStructuralTask } from "../src/lib/model-routing";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { routeHarness, stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/src/lib/openai.ts", support("stub-chatscope-openai.ts"));
stubModule("/src/lib/repository-retrieval.ts", support("stub-smallfix2-retrieval.ts"));
stubModule("/src/lib/repository-memory.ts", support("stub-smallfix2-retrieval.ts"));
stubModule("/src/lib/repository-text.ts", support("stub-smallfix2-repository-text.ts"));

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const QUESTION = "What do the papers report about peer feedback?";
const run = (index: number) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`;

/** Twelve analysed papers: more than a focused answer's ten sources, so widening the search can reach more. */
async function repository(papers = 12) {
  const harness = await routeHarness({ REPOSITORY_HYBRID_RETRIEVAL_ENABLED: "true" });
  await harness.signIn(OWNER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Language learning', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Studies', '${PROJECT}');
  `);
  for (let index = 1; index <= papers; index += 1) {
    const paperId = paperIdFromRunId(run(index));
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload) VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb)`,
      [run(index), OWNER, FOLDER]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [paperId, OWNER, FOLDER, String(2010 + index), `Peer feedback study ${index}`]);
    await harness.db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, body, ingestion_run_id) VALUES ($1, $2, $3, $4, $5)`,
      [paperId, OWNER, FOLDER, `Study ${index} examines peer feedback in writing classes. Students revised drafts after peer feedback ${index} times.`, run(index)]
    );
  }
  const chat = await import("../src/lib/repository-chat");
  (await import("../src/lib/answer-cache")).resetAnswerCache();
  const tasks: string[] = [];
  globalThis.__chatScopeModel = {
    calls: [],
    reply: (call) => {
      tasks.push(call.taskName);
      if (call.taskName === "CHAT_EXECUTION_PLAN") return plan(QUESTION);
      if (call.taskName === "CHAT_EVIDENCE_SUFFICIENCY") return { sufficient: true, missingEvidenceNeeds: [], expansionQueries: [], confidence: 0.9 };
      if (call.taskName === "CHAT_SYNTHESIS") return { answer: `Peer feedback helped revision [Paper ${paperIdFromRunId(run(1))}].`, citedPaperIds: [paperIdFromRunId(run(1))], confidence: 0.9 };
      return null;
    },
  };
  globalThis.__smallfix2Sequence = [];
  globalThis.__smallfix2SemanticFails = undefined;
  const input = { ownerUserId: OWNER, prompt: QUESTION, knowledgeScope: { kind: "project" as const, projectId: PROJECT }, projectId: PROJECT };
  return { ...harness, chat, tasks, input, ask: () => chat.runRepositoryChat(input) };
}

function plan(refinedQuestion: string): Omit<RepositoryExecutionPlan, "source"> {
  return {
    operation: "search_evidence", operations: ["search_evidence"], scopeMode: "focused", refinedQuestion, terms: [], retrievalQueries: [refinedQuestion],
    evidenceNeeds: [], requestedFields: [], answerLanguage: "English", outputFormat: "prose", chartType: "bar", reason: "test", confidence: "high",
  };
}

/** What a console method was called with, for the length of `work`. */
async function logged(level: "info" | "warn", work: () => Promise<unknown>) {
  const spy = mock.method(console, level, () => undefined);
  try {
    await work();
    return spy.mock.calls.map((call) => call.arguments.map(String));
  } finally {
    spy.mock.restore();
  }
}

test("the steps routed to the fast model are the ones the chat really runs under those names", async () => {
  // A renamed task would silently stop routing and quietly cost seconds again.
  const { tasks, ask } = await repository();
  await logged("info", ask);
  const structural = [...new Set(tasks.filter((task) => isStructuralTask(task)))].sort();
  assert.deepEqual(structural, ["CHAT_EVIDENCE_SUFFICIENCY", "CHAT_EXECUTION_PLAN"]);
  assert.ok(tasks.includes("CHAT_SYNTHESIS") && !isStructuralTask("CHAT_SYNTHESIS"));
});

test("the search by meaning starts before the in-memory ranking and is waited for after it", async () => {
  // Both need only the queries and the scope, and the merge is order
  // independent, so the embedding round trip should overlap the tokenising.
  const { ask } = await repository();
  await logged("info", ask);
  assert.deepEqual(globalThis.__smallfix2Sequence!.slice(0, 3), ["semantic search started", "rank", "semantic search settled"]);
});

test("a failed search by meaning still leaves the answer its papers", async () => {
  const { ask, tasks } = await repository();
  globalThis.__smallfix2SemanticFails = true;
  let answer: Awaited<ReturnType<typeof ask>> | undefined;
  await logged("info", async () => void (answer = await ask()));
  assert.ok(globalThis.__smallfix2Sequence!.includes("semantic search settled"), "the search was tried, and failed");
  assert.ok(tasks.includes("CHAT_SYNTHESIS"), "the answer was still written");
  assert.match(answer!.answer, /Peer feedback helped revision/);
  assert.ok(answer!.citations.some((citation) => String(citation.paperId) === paperIdFromRunId(run(1))), "from papers the ranking found");
});

test("whether the sufficiency check ran is recorded, and it is skipped when every paper is already selected", async () => {
  const large = await repository(12);
  const decisions = (lines: string[][]) => lines.filter((line) => line[0] === "chat_sufficiency_decision").map((line) => JSON.parse(line[1]));
  assert.deepEqual(decisions(await logged("info", large.ask)), [{ skipped: false, selected: 10, scoped: 12 }]);
  assert.ok(large.tasks.includes("CHAT_EVIDENCE_SUFFICIENCY"));

  const small = await repository(4);
  assert.deepEqual(decisions(await logged("info", small.ask)), [{ skipped: true, selected: 4, scoped: 4 }]);
  assert.ok(!small.tasks.includes("CHAT_EVIDENCE_SUFFICIENCY"), "the 3-second call is not made");
});

test("a question's load builds a word index only for a paper whose text changed, and writes nothing nobody reads", async () => {
  const { db, chat, input } = await repository(3);
  const changed = paperIdFromRunId(run(2));
  const load = async () => {
    globalThis.__smallfix2Indexed = [];
    let context: Awaited<ReturnType<typeof chat.loadRepositoryContext>> | undefined;
    const lines = await logged("info", async () => void (context = await chat.loadRepositoryContext(input)));
    const report = lines.filter((line) => line[0] === "chat_repository_load").map((line) => JSON.parse(line[1]));
    return { context: context!, indexed: globalThis.__smallfix2Indexed, report };
  };

  // The first question indexes and stores every paper.
  const first = await load();
  assert.equal(first.indexed.length, 3);
  assert.deepEqual(first.report.map((entry) => [entry.papers, entry.indexesBuilt]), [[3, 3]]);
  const stored = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM paper_term_index WHERE owner_user_id = $1`, [OWNER]);
  assert.equal(stored.rows[0].n, "3");

  // A stored index is used as it is: its counts, not the text's.
  const unchanged = paperIdFromRunId(run(1));
  await db.query(`UPDATE paper_term_index SET term_counts = '{"stored": 7}'::jsonb, total_words = 7 WHERE paper_id = $1`, [unchanged]);
  await db.query(`UPDATE paper_content SET body = 'Rewritten text about assessment rubrics.' WHERE paper_id = $1`, [changed]);
  const cachesBefore = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM workspace_analytics_cache`);
  const second = await load();
  assert.deepEqual(second.indexed, ["Rewritten text about assessment rubrics."], "only the changed paper's text is indexed");
  assert.deepEqual(second.report.map((entry) => [entry.papers, entry.indexesBuilt]), [[3, 1]]);
  const paper = second.context.papers.find((entry) => entry.paperId === unchanged)!;
  assert.deepEqual([paper.termCounts, paper.totalWords], [{ stored: 7 }, 7]);
  const saved = await db.query<{ counts: Record<string, number> }>(`SELECT term_counts AS counts FROM paper_term_index WHERE paper_id = $1`, [changed]);
  assert.ok(saved.rows[0].counts.rubrics, "the changed paper's new index is stored");
  const cachesAfter = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM workspace_analytics_cache`);
  assert.equal(cachesAfter.rows[0].n, cachesBefore.rows[0].n, "no context row is written on a question");
});

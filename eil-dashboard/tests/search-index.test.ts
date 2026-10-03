import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { workerCallerAccounts } from "../src/lib/cloud-tasks-oidc";
import { INDEXED_PAPERS_SQL, SEMANTIC_PAPER_SQL } from "../src/lib/repository-memory";
import { fuseSemanticRanks, type RepositoryRetrievalCandidate } from "../src/lib/repository-retrieval";

/**
 * The search index keeps up with the papers, and stops steering (docs/32,
 * 2.3). Indexing, its route and the chat's use of it run in
 * research-behaviour-search-index.test.ts.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  Plans?: PlanNode[];
}

/** The node directly above the first node `match` accepts; null at the root, undefined if none matches. */
function parentOf(node: PlanNode, match: (node: PlanNode) => boolean, parent: PlanNode | null = null): PlanNode | null | undefined {
  if (match(node)) return parent;
  for (const child of node.Plans ?? []) {
    const found = parentOf(child, match, node);
    if (found !== undefined) return found;
  }
  return undefined;
}

function candidate(paperId: string, fusedScore: number): RepositoryRetrievalCandidate {
  return { paperId, title: `Paper ${paperId}`, excerpt: "", lexicalScore: fusedScore, metadataScore: 0, phraseScore: 0, fusedScore };
}
const ids = (list: RepositoryRetrievalCandidate[]) => list.map((item) => item.paperId);
// In-memory order A > B > C > D, with small gaps so the semantic channel can matter.
const inMemory = () => [candidate("A", 0.05), candidate("B", 0.049), candidate("C", 0.048), candidate("D", 0.047)];

test("a paper missing from the index is not ranked lower for it", () => {
  // Only B is indexed, and the index ranks it first. The old merge put every
  // indexed paper ahead of every other; A must stay ahead of B.
  assert.deepEqual(ids(fuseSemanticRanks(inMemory(), { rankedPaperIds: ["B"], indexedPaperIds: ["B"] })), ["A", "B", "C", "D"]);
  // Nothing indexed at all: the in-memory order stands.
  assert.deepEqual(ids(fuseSemanticRanks(inMemory(), { rankedPaperIds: [], indexedPaperIds: [] })), ["A", "B", "C", "D"]);
});

test("the semantic channel reorders indexed papers by meaning", () => {
  // All indexed; only D is near the question in meaning.
  const fused = fuseSemanticRanks(inMemory(), { rankedPaperIds: ["D"], indexedPaperIds: ["A", "B", "C", "D"] });
  assert.deepEqual(ids(fused), ["D", "A", "B", "C"], "a semantic match is lifted; the rest keep their order");
  // An indexed paper the index did not rank gets nothing from the channel.
  assert.equal(fused.find((item) => item.paperId === "A")!.fusedScore, 0.05);
});

test("papers outside the scope are ignored, and the limit holds", () => {
  const fused = fuseSemanticRanks(inMemory(), { rankedPaperIds: ["TRASHED", "C"], indexedPaperIds: ["TRASHED", "C"] }, 2);
  assert.equal(fused.length, 2);
  assert.ok(!ids(fused).includes("TRASHED"));
});

test("the semantic SQL ranks papers by their closest chunk, within the owner and scope, reading the nearest from the vector index", async () => {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`
    CREATE EXTENSION vector;
    CREATE TABLE paper_retrieval_chunks (
      id serial PRIMARY KEY, owner_user_id uuid NOT NULL, project_id uuid, folder_id uuid,
      paper_id bigint NOT NULL, embedding vector(3));
    -- As in schema.sql.
    CREATE INDEX chunks_embedding ON paper_retrieval_chunks USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
  `);
  const owner = "00000000-0000-0000-0000-00000000000a";
  const other = "00000000-0000-0000-0000-00000000000b";
  const project = "00000000-0000-0000-0000-0000000000a1";
  const elsewhere = "00000000-0000-0000-0000-0000000000a2";
  const rows: Array<[string, string, number, string | null]> = [
    [owner, project, 1, "[1,0,0]"],       // paper 1: one chunk exactly on the question
    [owner, project, 1, "[0,1,0]"],
    [owner, project, 2, "[0.8,0.6,0]"],   // paper 2: close
    [owner, project, 3, "[0,0,1]"],       // paper 3: far
    [owner, project, 4, null],            // paper 4: no vector yet
    [owner, elsewhere, 5, "[1,0,0]"],     // another repository
    [other, project, 6, "[1,0,0]"],       // another owner
  ];
  for (const [who, where, paper, embedding] of rows) {
    await db.query(`INSERT INTO paper_retrieval_chunks (owner_user_id, project_id, paper_id, embedding) VALUES ($1,$2,$3,$4::vector)`, [who, where, paper, embedding]);
  }
  const scope = [owner, project, null];
  const indexed = (await db.query<{ paper_id: string }>(INDEXED_PAPERS_SQL, scope)).rows.map((row) => row.paper_id).sort();
  assert.deepEqual(indexed, ["1", "2", "3"], "papers with a vector, in scope");
  const ranked = (await db.query<{ paper_id: string }>(SEMANTIC_PAPER_SQL, [...scope, "[1,0,0]", 10])).rows.map((row) => row.paper_id);
  assert.deepEqual(ranked, ["1", "2", "3"], "each paper once, by its closest chunk");
  const limited = (await db.query<{ paper_id: string }>(SEMANTIC_PAPER_SQL, [...scope, "[1,0,0]", 1])).rows.map((row) => row.paper_id);
  assert.deepEqual(limited, ["1"]);
  // The nearest chunks are read from the vector index straight under a LIMIT;
  // the old row_number() ordering put a window between them. Seq scans are
  // off, as on a table large enough for the index to pay.
  await db.exec("SET enable_seqscan = off");
  const explained = await db.query<{ "QUERY PLAN": [{ Plan: PlanNode }] }>(`EXPLAIN (FORMAT JSON) ${SEMANTIC_PAPER_SQL}`, [...scope, "[1,0,0]", 10]);
  const plan = explained.rows[0]["QUERY PLAN"][0].Plan;
  assert.equal(parentOf(plan, (node) => node["Index Name"] === "chunks_embedding")?.["Node Type"], "Limit");
  await db.close();
});

test("the worker's stale-index query picks what needs indexing, and nothing it cannot index", async () => {
  // The worker's own SQL, taken from its Python and run here against Postgres.
  const python = read("worker/database_client.py").match(/STALE_SEARCH_INDEX_SQL = \(([\s\S]*?)\n\)/)?.[1] ?? "";
  let n = 0;
  const staleSql = [...python.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]).join("").replace(/%s/g, () => `$${++n}`);
  // Deployment, owner (row-level security is read per owner: search-index-rls.test.ts), limit.
  assert.equal(n, 3);
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE ingestion_runs (
      id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, source_type text NOT NULL DEFAULT 'upload',
      status text NOT NULL, trashed_at timestamptz, input_payload jsonb NOT NULL DEFAULT '{}',
      completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), folder_id uuid);
    CREATE TABLE research_folders (id uuid PRIMARY KEY, project_id uuid);
    INSERT INTO research_folders VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1');
    CREATE TABLE paper_content (paper_id bigint PRIMARY KEY, ingestion_run_id uuid);
    CREATE TABLE paper_retrieval_documents (owner_user_id uuid, paper_id bigint, updated_at timestamptz NOT NULL);
  `);
  const owner = "00000000-0000-0000-0000-00000000000a";
  const run = (n: number) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
  const add = async (
    n: number,
    status: string,
    completed: string,
    options: { trashed?: boolean; pilot?: boolean; content?: boolean; indexedAt?: string; noFolder?: boolean } = {}
  ) => {
    await db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, status, trashed_at, input_payload, completed_at, folder_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        run(n),
        owner,
        status,
        options.trashed ? "2026-10-01T00:00:00Z" : null,
        options.pilot ? { deployment: "pilot" } : {},
        completed,
        options.noFolder ? null : "00000000-0000-0000-0000-0000000000f1",
      ]
    );
    if (options.content !== false) await db.query(`INSERT INTO paper_content VALUES ($1,$2)`, [1000 + n, run(n)]);
    if (options.indexedAt) await db.query(`INSERT INTO paper_retrieval_documents VALUES ($1,$2,$3)`, [owner, 1000 + n, options.indexedAt]);
  };
  await add(1, "succeeded", "2026-09-30T10:00:00Z");                                           // never indexed
  await add(2, "succeeded", "2026-09-30T10:00:00Z", { indexedAt: "2026-09-30T11:00:00Z" });   // indexed since
  await add(3, "succeeded", "2026-09-30T12:00:00Z", { indexedAt: "2026-09-30T11:00:00Z" });   // re-analysed since
  await add(4, "succeeded", "2026-09-30T10:00:00Z", { trashed: true });                        // in the trash
  await add(5, "queued", "2026-09-30T10:00:00Z", { indexedAt: "2026-09-29T00:00:00Z" });       // being re-analysed: keep the old index
  await add(6, "succeeded", "2026-09-30T10:00:00Z", { pilot: true });                          // the pilot's
  await add(7, "succeeded", "2026-09-30T10:00:00Z", { content: false });                       // a copy with no content of its own
  await add(8, "succeeded", "2026-09-30T10:00:00Z", { noFolder: true });                       // from before repositories: no chat searches it
  const picked = (await db.query<{ run_id: string }>(staleSql, ["production", owner, 10])).rows.map((row) => row.run_id).sort();
  assert.deepEqual(picked, [run(1), run(3)]);
  const pilot = (await db.query<{ run_id: string }>(staleSql, ["pilot", owner, 10])).rows.map((row) => row.run_id);
  assert.deepEqual(pilot, [run(6)]);
  await db.close();
});

test("the worker asks for a paper to be indexed when its analysis succeeds", () => {
  // Python, and no Python test covers the success path's call (an idle
  // worker's catch-up is covered in tests/test_worker_search_index.py).
  const worker = read("worker/process_ingestion_queue.py");
  const success = worker.slice(worker.indexOf('run["status"] = "succeeded"'));
  assert.ok(success.indexOf("request_search_index(") < success.indexOf("mirror_completed_dataset"), "indexed on success");
});

test("each worker deploy points search indexing at its own web service, which admits the worker's account", () => {
  for (const [yaml, url] of [
    ["../cloudbuild.worker.production.yaml", "https://papertrend-web-production-javhavgdsq-as.a.run.app/api/workspace/repository-memory/index"],
    ["../cloudbuild.worker.cloudsql.pilot.yaml", "https://papertrend-web-cloudsql-pilot-javhavgdsq-as.a.run.app/api/workspace/repository-memory/index"],
  ]) {
    const text = read(yaml);
    assert.match(text, /SEARCH_INDEX_URL=\$\{_SEARCH_INDEX_URL\}/, yaml);
    assert.ok(text.includes(`_SEARCH_INDEX_URL: ${url}`), yaml);
  }
  assert.match(read("../cloudbuild.web.production.yaml"), /_WORKER_CALLER_SERVICE_ACCOUNTS: papertrend-worker-production@/);
});

test("only service accounts can be named as worker callers", () => {
  assert.deepEqual(
    workerCallerAccounts("papertrend-worker-production@p.iam.gserviceaccount.com; someone@gmail.com, ,Other@P.iam.gserviceaccount.com"),
    ["papertrend-worker-production@p.iam.gserviceaccount.com", "other@p.iam.gserviceaccount.com"]
  );
  assert.deepEqual(workerCallerAccounts(undefined), []);
});

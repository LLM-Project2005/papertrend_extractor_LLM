import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import { copyPaperAnalysis, movePaperRows, PAPER_TABLES, paperIdFromRunSql, paperOfRun } from "../src/lib/cloudsql/paper-copy";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { assertRoomForAnotherPaper, LibraryActionError } from "../src/lib/cloudsql/library-repository";
import { MAX_PAPERS_PER_ACCOUNT } from "../src/lib/upload-safety";

/** Copied and moved papers appear where they are, and a copy is corrected on its own (docs/32, 2.5). */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const ORIGINAL_RUN = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const COPY_RUN = "f0e1d2c3-b4a5-4968-8776-655443322110";

async function database() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  for (const file of ["schema.sql", "phase8_chat_v2.sql"]) await db.exec(read(`cloudsql/${file}`));
  const client = { query: (text: string, params?: unknown[]) => db.query(text, params) } as never;
  await db.exec(`
    INSERT INTO user_profiles (id, email) VALUES ('${OWNER}', 'owner@example.edu'), ('${OTHER}', 'other@example.edu');
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name) VALUES
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'Repository A'),
      ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'Repository B');
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '${OWNER}', 'A', '00000000-0000-0000-0000-0000000000a1'),
      ('00000000-0000-0000-0000-0000000000f2', '${OWNER}', 'B', '00000000-0000-0000-0000-0000000000a2');
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, input_payload) VALUES
      ('${ORIGINAL_RUN}', '${OWNER}', '00000000-0000-0000-0000-0000000000f1', 'upload', 'succeeded', '{"paper_id": ${paperIdFromRunId(ORIGINAL_RUN)}}'),
      ('${COPY_RUN}', '${OWNER}', '00000000-0000-0000-0000-0000000000f1', 'upload', 'succeeded', '{"paper_id": ${paperIdFromRunId(ORIGINAL_RUN)}}');
  `);
  const original = paperIdFromRunId(ORIGINAL_RUN);
  await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, '00000000-0000-0000-0000-0000000000f1', '2021', 'Peer feedback in writing')`, [original, OWNER]);
  await db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract) VALUES ($1, $2, '00000000-0000-0000-0000-0000000000f1', $3, 'An abstract.')`, [original, OWNER, ORIGINAL_RUN]);
  await db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1,$2,'00000000-0000-0000-0000-0000000000f1','Feedback','peer feedback'), ($1,$2,'00000000-0000-0000-0000-0000000000f1','Writing','accuracy')`, [original, OWNER]);
  await db.query(`INSERT INTO paper_tracks_single (paper_id, owner_user_id, folder_id) VALUES ($1, $2, '00000000-0000-0000-0000-0000000000f1')`, [original, OWNER]);
  return { db, client, original };
}

test("a copy counts toward the account's papers; exempt roles are exempt (LIB-5)", async () => {
  const { db, client } = await database();
  // The account holds one paper; fill it to one below the limit.
  for (let index = 1; index < MAX_PAPERS_PER_ACCOUNT - 1; index += 1) {
    await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, '00000000-0000-0000-0000-0000000000f1', '2020', $3)`, [
      String(1_000_000 + index),
      OWNER,
      `Paper ${index}`,
    ]);
  }
  await assertRoomForAnotherPaper(client, OWNER);
  await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ('999', $1, '00000000-0000-0000-0000-0000000000f1', '2020', 'The last one')`, [OWNER]);
  await assert.rejects(assertRoomForAnotherPaper(client, OWNER), (error: unknown) =>
    error instanceof LibraryActionError && error.status === 409 && /up to \d+ papers, and a copy is one more/.test(error.message)
  );
  // Another account's papers are not counted against this one.
  await assertRoomForAnotherPaper(client, OTHER);
  await db.query(`UPDATE user_profiles SET role = 'admin' WHERE id = $1`, [OWNER]);
  await assertRoomForAnotherPaper(client, OWNER);
  await db.close();
  // Making a copy is where it is asked.
  const library = read("src/lib/cloudsql/library-repository.ts");
  const copyRun = library.slice(library.indexOf("async copyRun("), library.indexOf("async copyRun(") + 1500);
  assert.match(copyRun, /await assertRoomForAnotherPaper\(client, ownerUserId\);/);
});

test("the SQL paper id is the one the worker and the web give the run", async () => {
  const db = new PGlite();
  for (const runId of [ORIGINAL_RUN, COPY_RUN, "ffffffff-ffff-4fff-bfff-ffffffffffff", "00000000-0000-4000-8000-000000000001"]) {
    const result = await db.query<{ id: string }>(`SELECT ${paperIdFromRunSql("$1")}::text AS id`, [runId]);
    assert.equal(result.rows[0].id, paperIdFromRunId(runId), runId);
  }
  await db.close();
});

test("a copy gets its own analysis under its own paper id, and the original is untouched", async () => {
  const { db, client, original } = await database();
  assert.equal(await paperOfRun(client, OWNER, ORIGINAL_RUN), original);
  assert.equal(await paperOfRun(client, OWNER, COPY_RUN), null, "a run-only copy has no content of its own");

  await copyPaperAnalysis(client, { ownerUserId: OWNER, fromPaperId: original, toRunId: COPY_RUN });
  const copy = paperIdFromRunId(COPY_RUN);
  assert.equal(await paperOfRun(client, OWNER, COPY_RUN), copy);
  const count = async (table: string, paperId: string) =>
    Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE ${table === "papers" ? "id" : "paper_id"} = $1`, [paperId])).rows[0].n);
  for (const table of ["papers", "paper_content", "paper_keywords", "paper_tracks_single"]) {
    assert.equal(await count(table, copy), await count(table, original), table);
  }
  // The copy's payload names its own paper, exactly (a 60-bit number).
  const payload = await db.query<{ paper_id: string }>(`SELECT input_payload->>'paper_id' AS paper_id FROM ingestion_runs WHERE id = $1`, [COPY_RUN]);
  assert.equal(payload.rows[0].paper_id, copy);
  // What the chat and dashboard loaders join on finds the copy with its own content.
  const loaded = await db.query<{ paper_id: string; title: string }>(
    `SELECT p.id::text AS paper_id, p.title FROM papers p JOIN paper_content pc ON pc.paper_id = p.id
     JOIN ingestion_runs ir ON ir.id = pc.ingestion_run_id WHERE ir.id = $1`, [COPY_RUN]);
  assert.deepEqual(loaded.rows, [{ paper_id: copy, title: "Peer feedback in writing" }]);
  // A correction to the copy changes the copy only.
  await db.query(`UPDATE papers SET title = 'Corrected title' WHERE id = $1 AND owner_user_id = $2`, [copy, OWNER]);
  const titles = await db.query<{ id: string; title: string }>(`SELECT id::text, title FROM papers ORDER BY title`);
  assert.deepEqual(titles.rows.map((row) => row.title).sort(), ["Corrected title", "Peer feedback in writing"]);
  // Another owner's rows are never copied from.
  await assert.rejects(copyPaperAnalysis(client, { ownerUserId: OTHER, fromPaperId: original, toRunId: COPY_RUN }).then(async () => {
    if (await count("papers", copy) !== 1) throw new Error("copied");
  }).then(() => { throw new Error("no rows for another owner, as expected"); }), /as expected/);
  await db.close();
});

test("a moved paper's rows and search index move with it", async () => {
  const { db, client, original } = await database();
  await db.query(`INSERT INTO paper_retrieval_chunks (owner_user_id, project_id, folder_id, paper_id, ingestion_run_id, section, chunk_index, content, content_hash, token_count)
    VALUES ($1, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', $2, $3, 'abstract', 0, 'An abstract.', $4, 3)`, [OWNER, original, ORIGINAL_RUN, "a".repeat(64)]);
  await movePaperRows(client, { ownerUserId: OWNER, paperId: original, folderId: "00000000-0000-0000-0000-0000000000f2", projectId: "00000000-0000-0000-0000-0000000000a2" });
  for (const table of ["papers", "paper_content", "paper_keywords", "paper_tracks_single"]) {
    const folders = await db.query<{ folder_id: string }>(`SELECT DISTINCT folder_id::text FROM ${table} WHERE ${table === "papers" ? "id" : "paper_id"} = $1`, [original]);
    assert.deepEqual(folders.rows.map((row) => row.folder_id), ["00000000-0000-0000-0000-0000000000f2"], table);
  }
  const chunk = await db.query<{ project_id: string; folder_id: string }>(`SELECT project_id::text, folder_id::text FROM paper_retrieval_chunks WHERE paper_id = $1`, [original]);
  assert.deepEqual(chunk.rows[0], { project_id: "00000000-0000-0000-0000-0000000000a2", folder_id: "00000000-0000-0000-0000-0000000000f2" });
  await db.close();
});

test("the table list is the worker's, and the Library uses it", () => {
  const persistence = read("worker/analysis_pipeline/persistence.py");
  // The table in each ("upsert", table, rows) step and each (dataset key, table) pair.
  const workerTables = [
    ...persistence.matchAll(/\("upsert", "([a-z_]+)"/g),
    ...persistence.matchAll(/\("[a-z_]+", "(paper_[a-z_]+)"\),/g),
  ].map((match) => match[1]);
  assert.deepEqual([...new Set(workerTables)].sort(), [...PAPER_TABLES].sort(), "copy every table the worker writes");
  const library = read("src/lib/cloudsql/library-repository.ts");
  const copyRun = library.slice(library.indexOf("async copyRun("), library.indexOf("async moveRun("));
  assert.ok(copyRun.indexOf("paperOfRun(") < copyRun.indexOf("assertRoomForAnotherPaper(") && copyRun.indexOf("assertRoomForAnotherPaper(") < copyRun.indexOf("INSERT INTO public.ingestion_runs"), "checked before the copy is made");
  assert.match(copyRun, /copyPaperAnalysis\(client, \{ ownerUserId, fromPaperId: sourcePaperId, toRunId: String\(created\.id\) \}\)/);
  const moveRun = library.slice(library.indexOf("async moveRun("));
  assert.match(moveRun, /FROM public\.research_folders WHERE id = \$1 AND owner_user_id = \$2/, "only into the owner's own folders");
  assert.match(read("src/app/api/workspace/library/[runId]/route.ts"), /cloudSqlLibraryRepository\.moveRun\(user\.id, runId, body\.folderId\)/);
  const correction = read("src/lib/cloudsql/analysis-job-repository.ts");
  assert.match(correction, /return paper\.rows\[0\] \?\? null;/, "a correction with no paper reports it");
});

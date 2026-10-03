/*
 * The Library's copy, move and correction, called as a signed-in person
 * against PGlite (docs/32, long-term health; tests/support/route-harness.ts):
 * a copy is checked before it is made and gets its own analysis, a move goes
 * only into the owner's folders, and a correction with no paper says so.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { MAX_PAPERS_PER_ACCOUNT } from "../src/lib/upload-safety";
import { params, routeHarness, stubModule } from "./support/route-harness";
import { resolveServerOnlyAsServer } from "./support/stub-bootsec-server-only";

resolveServerOnlyAsServer();
stubModule("/node_modules/@google-cloud/storage/build/cjs/src/index.js", new URL("./support/stub-smallfix2-storage.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const FOLDER_A = "00000000-0000-4000-8000-0000000000f1";
const FOLDER_B = "00000000-0000-4000-8000-0000000000f2";
const OTHER_FOLDER = "00000000-0000-4000-8000-0000000000f9";
const PROJECT_B = "00000000-0000-4000-8000-0000000000a2";
const RUN = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
const UNANALYSED_RUN = "2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52";

async function library() {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'A', '{}'::jsonb, 2, 'test', now()),
      ('${PROJECT_B}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'B', '{}'::jsonb, 2, 'test', now()),
      ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Theirs', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES
      ('${FOLDER_A}', '${OWNER}', 'A', '00000000-0000-4000-8000-0000000000a1'),
      ('${FOLDER_B}', '${OWNER}', 'B', '${PROJECT_B}'),
      ('${OTHER_FOLDER}', '${OTHER}', 'Z', '00000000-0000-4000-8000-0000000000a9');
  `);
  for (const run of [RUN, UNANALYSED_RUN]) {
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload)
       VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', jsonb_build_object('paper_id', $4::bigint))`,
      [run, OWNER, FOLDER_A, paperIdFromRunId(run)]
    );
  }
  const paper = paperIdFromRunId(RUN);
  await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', 'Peer feedback in writing')`, [paper, OWNER, FOLDER_A]);
  await harness.db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract) VALUES ($1, $2, $3, $4, 'An abstract.')`, [paper, OWNER, FOLDER_A, RUN]);
  await harness.db.query(
    `INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, 'Feedback', 'peer feedback'), ($1, $2, $3, 'Writing', 'accuracy')`,
    [paper, OWNER, FOLDER_A]
  );
  const route = await import("../src/app/api/workspace/library/[runId]/route");
  const call = (method: "POST" | "PATCH", runId: string, headers: Record<string, string>, body: unknown) =>
    route[method](harness.request(`/api/workspace/library/${runId}`, { method, headers, body }), params({ runId }));
  const runCount = async () => Number((await harness.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ingestion_runs`)).rows[0].n);
  return { ...harness, owner, other, call, runCount, paper };
}

test("a copy made in the Library has its own analysis under its own paper id; the original is untouched", async () => {
  const { db, owner, call, paper } = await library();
  const response = await call("POST", RUN, owner, { action: "copy" });
  assert.equal(response.status, 201);
  const { run } = (await response.json()) as { run: { id: string; display_name: string } };
  assert.notEqual(run.id, RUN);
  assert.equal(run.display_name, "paper.pdf copy");
  const copy = paperIdFromRunId(run.id);
  const keywords = async (paperId: string) =>
    (await db.query<{ keyword: string }>(`SELECT keyword FROM paper_keywords WHERE paper_id = $1 ORDER BY keyword`, [paperId])).rows.map((row) => row.keyword);
  assert.deepEqual(await keywords(copy), ["accuracy", "peer feedback"]);
  const content = await db.query<{ run: string }>(`SELECT ingestion_run_id::text AS run FROM paper_content WHERE paper_id = $1`, [copy]);
  assert.deepEqual(content.rows, [{ run: run.id }], "the copy's content row is the copy's run");
  assert.deepEqual(await keywords(paper), ["accuracy", "peer feedback"]);

  // A correction to the copy changes the copy only.
  const corrected = await call("PATCH", run.id, owner, { action: "correct", title: "Corrected title" });
  assert.equal(corrected.status, 200);
  const titles = await db.query<{ id: string; title: string }>(`SELECT id::text, title FROM papers ORDER BY title`);
  assert.deepEqual(titles.rows, [{ id: copy, title: "Corrected title" }, { id: paper, title: "Peer feedback in writing" }]);
});

test("a copy is refused, and no run is made, when the account is full or the paper was never analysed", async () => {
  const { db, owner, call, runCount } = await library();
  for (let index = 1; index < MAX_PAPERS_PER_ACCOUNT; index += 1) {
    await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2020', 'Filler')`, [String(7_000_000 + index), OWNER, FOLDER_A]);
  }
  const before = await runCount();
  const full = await call("POST", RUN, owner, { action: "copy" });
  assert.equal(full.status, 409);
  assert.match((await full.json()).error, /up to 50 papers, and a copy is one more/);
  const unanalysed = await call("POST", UNANALYSED_RUN, owner, { action: "copy" });
  assert.equal(unanalysed.status, 409);
  assert.match((await unanalysed.json()).error, /Only a paper that has been analysed can be copied/);
  assert.equal(await runCount(), before, "nothing was made");

  // An admin is not held to the limit.
  await db.query(`UPDATE user_profiles SET role = 'admin' WHERE id = $1`, [OWNER]);
  assert.equal((await call("POST", RUN, owner, { action: "copy" })).status, 201);
  assert.equal(await runCount(), before + 1);
});

test("a paper moves only into its owner's folders, with its analysis and its new repository", async () => {
  const { db, owner, other, call, paper } = await library();
  const where = async () =>
    (await db.query<{ folder: string; project: string | null }>(`SELECT folder_id::text AS folder, input_payload->>'project_id' AS project FROM ingestion_runs WHERE id = $1`, [RUN])).rows[0];

  const intoTheirs = await call("PATCH", RUN, owner, { action: "move", folderId: OTHER_FOLDER });
  assert.equal(intoTheirs.status, 404);
  const byThem = await call("PATCH", RUN, other, { action: "move", folderId: OTHER_FOLDER });
  assert.equal(byThem.status, 404, "another person cannot move the owner's paper into their folder");
  assert.deepEqual(await where(), { folder: FOLDER_A, project: null });

  const moved = await call("PATCH", RUN, owner, { action: "move", folderId: FOLDER_B });
  assert.equal(moved.status, 200);
  assert.deepEqual(await where(), { folder: FOLDER_B, project: PROJECT_B });
  const rows = await db.query<{ folder: string }>(`SELECT DISTINCT folder_id::text AS folder FROM paper_keywords WHERE paper_id = $1`, [paper]);
  assert.deepEqual(rows.rows, [{ folder: FOLDER_B }]);
});

test("a correction to a paper with no saved analysis says so, and changes nothing", async () => {
  const { db, owner, call } = await library();
  const response = await call("PATCH", UNANALYSED_RUN, owner, { action: "correct", title: "New title" });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "This paper has no saved analysis to correct.");
  const payload = await db.query<{ overrides: unknown }>(`SELECT input_payload->'user_overrides' AS overrides FROM ingestion_runs WHERE id = $1`, [UNANALYSED_RUN]);
  assert.equal(payload.rows[0].overrides, null, "nothing was saved on the run either");
});

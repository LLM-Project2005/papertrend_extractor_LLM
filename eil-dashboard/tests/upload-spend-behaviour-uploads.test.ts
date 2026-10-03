/*
 * The upload journey's server side, run rather than read (docs/32, long-term
 * health): how the Library names and copies papers, what the progress card is
 * sent, the tray's status request, and the retired debug queue clearer,
 * against PGlite under the app's role (tests/support/route-harness.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getRunDisplayTitle } from "../src/lib/ingestion-status";
import { paperIdFromRunId } from "../src/lib/paper-id";
import type { IngestionRunRow } from "../src/types/database";
import { routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const PROJECT_A = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_B = "00000000-0000-4000-8000-0000000000a2";
const EMPTY_PROJECT = "00000000-0000-4000-8000-0000000000a3";
const FOLDER_A = "00000000-0000-4000-8000-0000000000f1";
const FOLDER_B = "00000000-0000-4000-8000-0000000000f2";
const OTHER_FOLDER = "00000000-0000-4000-8000-0000000000f9";
const ANALYSED = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
const QUEUED = "2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52";
const TRASHED = "3a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c53";
const PROCESSING = "4a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c54";
const OTHER_RUN = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
/** What JSON.parse made of a stored paper_id on the pilot: a different paper's id. */
const ROUNDED_PAPER_ID = "1093441516503213200";

async function workspace() {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  const admin = await harness.signIn(ADMIN, { role: "admin" });
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT_A}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'A', '{}'::jsonb, 2, 'test', now()),
      ('${PROJECT_B}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'B', '{}'::jsonb, 2, 'test', now()),
      ('${EMPTY_PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Empty', '{}'::jsonb, 2, 'test', now()),
      ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Theirs', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES
      ('${FOLDER_A}', '${OWNER}', 'A', '${PROJECT_A}'),
      ('${FOLDER_B}', '${OWNER}', 'B', '${PROJECT_B}'),
      ('${OTHER_FOLDER}', '${OTHER}', 'Z', '00000000-0000-4000-8000-0000000000a9');
  `);
  return { ...harness, owner, other, admin };
}

async function addRun(
  db: Awaited<ReturnType<typeof routeHarness>>["db"],
  run: { id: string; owner?: string; folder?: string; status?: string; payload?: string; trashed?: boolean; filename?: string }
) {
  await db.query(
    `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, display_name, input_payload, trashed_at)
     VALUES ($1, $2, $3, 'upload', $4, $5, $5, $6::jsonb, CASE WHEN $7 THEN now() END)`,
    [run.id, run.owner ?? OWNER, run.folder ?? FOLDER_A, run.status ?? "succeeded", run.filename ?? "paper.pdf", run.payload ?? "{}", run.trashed ?? false]
  );
}

async function addAnalysis(db: Awaited<ReturnType<typeof routeHarness>>["db"], runId: string, title: string, owner = OWNER, folder = FOLDER_A) {
  const paper = paperIdFromRunId(runId);
  await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [paper, owner, folder, title]);
  await db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract) VALUES ($1, $2, $3, $4, 'a')`, [paper, owner, folder, runId]);
}

/* ------------------------------------------------------------ the Library */

test("the Library names each paper by its own analysis, not by the rounded id in its payload", async () => {
  const { db } = await workspace();
  // The rounded id is another paper's: a join on the payload would name the wrong one.
  await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2020', 'A different paper')`, [ROUNDED_PAPER_ID, OWNER, FOLDER_A]);
  await addRun(db, { id: ANALYSED, filename: "plosive.pdf", payload: `{"paper_id": ${ROUNDED_PAPER_ID}}` });
  await addAnalysis(db, ANALYSED, "Voice Onset Time in Thai Learners");
  await addRun(db, { id: QUEUED, folder: FOLDER_B, status: "queued", filename: "queued.pdf" });
  await addRun(db, { id: TRASHED, trashed: true });
  await addRun(db, { id: PROCESSING, status: "processing" });
  await addRun(db, { id: OTHER_RUN, owner: OTHER, folder: OTHER_FOLDER });
  await addAnalysis(db, OTHER_RUN, "Someone else's paper", OTHER, OTHER_FOLDER);

  const { cloudSqlLibraryRepository } = await import("../src/lib/cloudsql/library-repository");
  const list = (options: { projectId?: string; includeTrashed?: boolean; logsOnly?: boolean } = {}, who = OWNER) =>
    cloudSqlLibraryRepository.listRuns(who, { limit: 50, offset: 0, ...options });
  const ids = (runs: IngestionRunRow[]) => runs.map((run) => run.id).sort();

  const all = await list();
  assert.deepEqual(ids(all), [ANALYSED, QUEUED, PROCESSING].sort(), "the owner's own, out of Trash");
  const analysed = all.find((run) => run.id === ANALYSED)!;
  assert.equal(analysed.paper_title, "Voice Onset Time in Thai Learners");
  assert.equal(getRunDisplayTitle(analysed), "Voice Onset Time in Thai Learners", "named by its title, not plosive.pdf");
  assert.equal(all.find((run) => run.id === QUEUED)!.paper_title, null, "not analysed yet");

  // Each filter runs, alone and together with the title join.
  assert.deepEqual(ids(await list({ projectId: PROJECT_A })), [ANALYSED, PROCESSING].sort());
  assert.deepEqual(ids(await list({ projectId: EMPTY_PROJECT })), []);
  assert.deepEqual(ids(await list({ includeTrashed: true })), [ANALYSED, QUEUED, TRASHED, PROCESSING].sort());
  assert.deepEqual(ids(await list({ logsOnly: true, projectId: PROJECT_A })), [ANALYSED]);
  assert.deepEqual(ids(await list({}, OTHER)), [OTHER_RUN]);
});

test("a copy keeps its payload exactly, under its own exact paper id", async () => {
  const { db } = await workspace();
  // Numbers a JavaScript round trip would change: 2^53 + 1, and 19 digits of a fraction.
  const payload = `{"paper_id": ${paperIdFromRunId(ANALYSED)}, "paper_title": "Voice Onset Time", "raw_text_length": 9007199254740993, "cost_usd": 0.1234567890123456789}`;
  await addRun(db, { id: ANALYSED, payload });
  await addAnalysis(db, ANALYSED, "Voice Onset Time");
  const { cloudSqlLibraryRepository } = await import("../src/lib/cloudsql/library-repository");
  const copy = await cloudSqlLibraryRepository.copyRun(OWNER, ANALYSED);
  const rows = await db.query<{ id: string; rest: string; paper_id: string }>(
    `SELECT id, (input_payload - 'paper_id')::text AS rest, input_payload->>'paper_id' AS paper_id FROM ingestion_runs WHERE id = ANY($1::uuid[])`,
    [[ANALYSED, copy.id]]
  );
  const original = rows.rows.find((row) => row.id === ANALYSED)!;
  const copied = rows.rows.find((row) => row.id === copy.id)!;
  assert.equal(copied.rest, original.rest);
  assert.equal(original.paper_id, paperIdFromRunId(ANALYSED), "the original is untouched");
  assert.equal(copied.paper_id, paperIdFromRunId(copy.id), "the copy's own paper, to the last digit");
});

test("a Library copy opens as its own paper, not the one it was copied from", async () => {
  const { db, request, owner } = await workspace();
  await addRun(db, { id: ANALYSED, payload: `{"paper_id": ${paperIdFromRunId(ANALYSED)}}` });
  await addAnalysis(db, ANALYSED, "Voice Onset Time");
  const { cloudSqlLibraryRepository } = await import("../src/lib/cloudsql/library-repository");
  const copy = await cloudSqlLibraryRepository.copyRun(OWNER, ANALYSED);
  const { paperIdForRun } = await import("../src/lib/paper-id");
  const { GET } = await import("../src/app/api/workspace/library/route");
  // As the Library receives them, after JSON.parse has rounded each payload's paper_id.
  const { runs } = (await (await GET(request("/api/workspace/library", { headers: owner }))).json()) as { runs: IngestionRunRow[] };
  const content = await db.query<{ run: string; paper: string }>(`SELECT ingestion_run_id::text AS run, paper_id::text AS paper FROM paper_content`);
  const paperOf = new Map(content.rows.map((row) => [row.run, row.paper]));
  assert.equal(paperIdForRun(runs.find((run) => run.id === ANALYSED)!), paperOf.get(ANALYSED));
  assert.equal(paperIdForRun(runs.find((run) => run.id === copy.id)!), paperOf.get(copy.id));
});

/* ------------------------------------------------------- the progress card */

test("the progress card is sent the title, the last update, the finished steps and the detail it shows", async () => {
  const { db, request, owner, other } = await workspace();
  const payload = {
    paper_title: "Voice Onset Time",
    progress_updated_at: "2026-10-01T10:00:00Z",
    analysis_metrics: { completed_graph_nodes: ["segment"] },
    progress_detail: "In line for analysis.",
    progress_stage: "queued",
    last_worker_trigger_payload: { internal: true },
  };
  await addRun(db, { id: ANALYSED, status: "queued", payload: JSON.stringify(payload) });
  await addRun(db, { id: OTHER_RUN, owner: OTHER, folder: OTHER_FOLDER, payload: JSON.stringify(payload) });

  const folderAnalysis = await import("../src/app/api/folder-analysis/route");
  const adminImport = await import("../src/app/api/admin/import/route");
  for (const [name, call] of [
    ["folder-analysis", () => folderAnalysis.GET(request(`/api/folder-analysis?folderId=${FOLDER_A}`, { headers: owner }))],
    ["admin/import", () => adminImport.GET(request("/api/admin/import", { headers: owner }))],
  ] as const) {
    const response = await call();
    assert.equal(response.status, 200, name);
    const body = (await response.json()) as { runs: Array<{ id: string; input_payload: Record<string, unknown> }> };
    assert.deepEqual(body.runs.map((run) => run.id), [ANALYSED], `${name}: the owner's own run`);
    const sent = body.runs[0].input_payload;
    for (const key of ["paper_title", "progress_updated_at", "analysis_metrics", "progress_detail"] as const) {
      assert.deepEqual(sent[key], payload[key], `${name} sends ${key}`);
    }
    assert.equal(sent.last_worker_trigger_payload, undefined, `${name}: what the card never reads stays behind`);
  }
  const theirs = await adminImport.GET(request("/api/admin/import", { headers: other }));
  assert.deepEqual(((await theirs.json()) as { runs: Array<{ id: string }> }).runs.map((run) => run.id), [OTHER_RUN]);
  assert.equal((await adminImport.GET(request("/api/admin/import"))).status, 401);
});

test("the tray asks for its runs by id, signed in, and gets back only the caller's own", async () => {
  const { db, request, owner } = await workspace();
  await addRun(db, { id: ANALYSED, status: "processing", payload: `{"paper_title": "Mine"}` });
  await addRun(db, { id: OTHER_RUN, owner: OTHER, folder: OTHER_FOLDER });
  const job = "00000000-0000-4000-8000-0000000000b1";
  const otherJob = "00000000-0000-4000-8000-0000000000b9";
  await db.query(
    `INSERT INTO folder_analysis_jobs (id, owner_user_id, folder_id, status) VALUES ($1, $2, $3, 'processing'), ($4, $5, $6, 'processing')`,
    [job, OWNER, FOLDER_A, otherJob, OTHER, OTHER_FOLDER]
  );
  const { POST } = await import("../src/app/api/workspace/runs/status/route");
  const ask = (body: unknown, headers: Record<string, string> = owner) => POST(request("/api/workspace/runs/status", { headers, body }));

  assert.equal((await ask({ runIds: [ANALYSED] }, {})).status, 401);
  assert.equal((await ask({ runIds: [ANALYSED] }, { authorization: "Bearer forged" })).status, 401);
  const many = (count: number) => Array.from({ length: count }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  for (const body of [{}, { runIds: [] }, { runIds: ["not-a-uuid"] }, { runIds: many(201) }, { runIds: [ANALYSED], folderJobId: "x" }]) {
    assert.equal((await ask(body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await ask({ runIds: many(200) })).status, 200, "a re-analysis of 200 papers can be followed");

  const answer = await ask({ runIds: [ANALYSED, OTHER_RUN], folderJobId: job });
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get("cache-control"), "no-store");
  const body = (await answer.json()) as { runs: Array<{ id: string; input_payload: Record<string, unknown> }>; jobs: Array<{ id: string }> };
  assert.deepEqual(body.runs.map((run) => run.id), [ANALYSED], "never someone else's run");
  assert.equal(body.runs[0].input_payload.paper_title, "Mine");
  assert.deepEqual(body.jobs.map((entry) => entry.id), [job]);
  const foreignJob = await (await ask({ runIds: [ANALYSED], folderJobId: otherJob })).json();
  assert.deepEqual(foreignJob.jobs, []);
});

/* ---------------------------------------------------------- debug tools */

test("the old debug queue clearer changes nothing on Cloud SQL, even for an admin", async () => {
  const { db, request, admin } = await workspace();
  await addRun(db, { id: QUEUED, status: "queued" });
  const { POST } = await import("../src/app/api/folder-analysis/debug/clear-queue/route");
  const response = await POST(request("/api/folder-analysis/debug/clear-queue", { headers: admin, body: {} }));
  assert.equal(response.status, 410);
  const run = await db.query<{ status: string; error_message: string | null }>(`SELECT status, error_message FROM ingestion_runs WHERE id = $1`, [QUEUED]);
  assert.deepEqual(run.rows[0], { status: "queued", error_message: null });
});

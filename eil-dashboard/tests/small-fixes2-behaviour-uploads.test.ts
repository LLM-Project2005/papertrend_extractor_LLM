/*
 * Stored files and the upload routes, run (docs/32, long-term health):
 * src/lib/gcs-signed-urls.ts as written over a stand-in storage client that
 * records what it is asked (stub-smallfix2-storage.ts), the analysis worker
 * never called (stub-smallfix2-worker-queue.ts), and the routes signed in
 * against PGlite (tests/support/route-harness.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PAPERS_PER_ACCOUNT } from "../src/lib/upload-safety";
import { params, routeHarness, stubModule } from "./support/route-harness";
import { resolveServerOnlyAsServer } from "./support/stub-bootsec-server-only";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
resolveServerOnlyAsServer();
stubModule("/node_modules/@google-cloud/storage/build/cjs/src/index.js", support("stub-smallfix2-storage.ts"));
stubModule("/node_modules/@google-cloud/storage/build/esm/src/index.js", support("stub-smallfix2-storage.ts"));
stubModule("/src/lib/worker-queue-start.ts", support("stub-smallfix2-worker-queue.ts"));

const OWN = "uploads-staging";
const ENV = { GCS_UPLOAD_BUCKET: OWN, GCS_KNOWN_UPLOAD_BUCKETS: "uploads-production", STORAGE_PROVIDER: "gcs", MAX_UPLOAD_BYTES: "1048576" };
const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const JOB = "00000000-0000-4000-8000-0000000000b1";
const RUN = "11111111-1111-4111-8111-111111111111";

async function workspace() {
  const harness = await routeHarness(ENV);
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'A', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'A', '${PROJECT}');
    INSERT INTO folder_analysis_jobs (id, owner_user_id, folder_id, status, total_runs) VALUES ('${JOB}', '${OWNER}', '${FOLDER}', 'queued', 1);
  `);
  globalThis.__smallfix2Objects = {};
  globalThis.__smallfix2StorageCalls = [];
  globalThis.__smallfix2WorkerDown = undefined;
  return { ...harness, owner, other };
}

type Db = Awaited<ReturnType<typeof workspace>>["db"];

/** A run prepared for upload and still waiting for its file, as the prepare route leaves it. */
async function waitingRun(db: Db, run: string, fields: { minutesAgo?: number; sourcePath?: string; trashed?: boolean } = {}) {
  await db.query(
    `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, folder_analysis_job_id, source_type, status, source_filename, mime_type, source_path, trashed_at, created_at, input_payload)
     VALUES ($1, $2, $3, $4, 'upload', 'processing', 'paper.pdf', 'application/pdf', $5, $6, now() - make_interval(mins => $7::int), '{}'::jsonb)`,
    [run, OWNER, FOLDER, JOB, fields.sourcePath ?? null, fields.trashed ? new Date().toISOString() : null, fields.minutesAgo ?? 1]
  );
}

const calls = () => globalThis.__smallfix2StorageCalls ?? [];

test("storage is asked about, or told to delete, an object only in a bucket this deployment knows", async () => {
  await workspace();
  const gcs = await import("../src/lib/gcs-signed-urls");
  globalThis.__smallfix2Objects = {
    "uploads-production/pending/a/run-1/paper.pdf": { size: 2048, contentType: "application/pdf" },
    "someone-else/pending/a/run-1/paper.pdf": { size: 2048, contentType: "application/pdf" },
  };
  for (const path of ["gs://someone-else/pending/a/run-1/paper.pdf", "gs://uploads-production/../secrets", "gs://uploads-production"]) {
    assert.equal(await gcs.gcsObjectInfo(path), null, path);
    assert.equal(await gcs.gcsObjectExists(path), false, path);
    await gcs.deleteGcsObject(path);
  }
  assert.deepEqual(calls(), [], "storage was never asked");
  assert.ok(globalThis.__smallfix2Objects["someone-else/pending/a/run-1/paper.pdf"], "nothing was deleted");

  // The pilot reads production's papers from production's bucket.
  const known = "gs://uploads-production/pending/a/run-1/paper.pdf";
  assert.deepEqual(await gcs.gcsObjectInfo(known), { sizeBytes: 2048, contentType: "application/pdf" });
  assert.equal(await gcs.gcsObjectExists(known), true);
  await gcs.deleteGcsObject(known);
  assert.deepEqual(
    calls().map((call) => `${call.op} ${call.bucket}/${call.object}`),
    ["getMetadata uploads-production/pending/a/run-1/paper.pdf", "exists uploads-production/pending/a/run-1/paper.pdf", "delete uploads-production/pending/a/run-1/paper.pdf"]
  );
});

test("a Library paper opens from the known bucket its path names, and never from an unknown one", async () => {
  const { db, request, owner } = await workspace();
  const { POST } = await import("../src/app/api/workspace/library/[runId]/route");
  const open = async (sourcePath: string) => {
    await db.query(`DELETE FROM ingestion_runs WHERE id = $1`, [RUN]);
    await db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, source_path, input_payload) VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', $4, '{}'::jsonb)`,
      [RUN, OWNER, FOLDER, sourcePath]
    );
    const response = await POST(request(`/api/workspace/library/${RUN}`, { headers: owner, body: { action: "open" } }), params({ runId: RUN }));
    return ((await response.json()) as { url?: string }).url;
  };
  assert.equal(await open(`gs://uploads-production/pending/A/${RUN}/paper.pdf`), `https://storage.test/uploads-production/pending/A/${RUN}/paper.pdf?action=read`);
  assert.equal(await open(`gs://${OWN}/pending/A/${RUN}/paper.pdf`), `https://storage.test/${OWN}/pending/A/${RUN}/paper.pdf?action=read`);
  assert.equal(await open(`gs://someone-else/papers/${RUN}.pdf`), `https://storage.test/${OWN}/papers/${RUN}.pdf?action=read`, "an unknown bucket is not signed for");
  assert.deepEqual([...new Set(calls().map((call) => call.bucket))].sort(), ["uploads-production", OWN]);
});

test("an upload is finalized only from this deployment's own bucket", async () => {
  const { db, request, owner } = await workspace();
  await waitingRun(db, RUN);
  const { POST } = await import("../src/app/api/admin/import/finalize/route");
  const finalize = (storagePath: string) =>
    POST(request("/api/admin/import/finalize", { headers: owner, body: { folderJobId: JOB, uploaded: [{ runId: RUN, storagePath, fileName: "paper.pdf" }] } }));
  const status = async () => (await db.query<{ status: string; source_path: string | null }>(`SELECT status, source_path FROM ingestion_runs WHERE id = $1`, [RUN])).rows[0];

  globalThis.__smallfix2Objects = { [`uploads-production/pending/A/${RUN}/paper.pdf`]: { size: 2048, contentType: "application/pdf" } };
  const elsewhere = await finalize(`gs://uploads-production/pending/A/${RUN}/paper.pdf`);
  assert.equal(elsewhere.status, 202, "nothing queued");
  assert.deepEqual(await status(), { status: "processing", source_path: null });
  assert.deepEqual(calls(), [], "storage was not even asked about it");

  globalThis.__smallfix2Objects[`${OWN}/pending/A/${RUN}/paper.pdf`] = { size: 2048, contentType: "application/pdf" };
  const own = await finalize(`gs://${OWN}/pending/A/${RUN}/paper.pdf`);
  assert.equal(own.status, 201);
  assert.deepEqual(await status(), { status: "queued", source_path: `gs://${OWN}/pending/A/${RUN}/paper.pdf` });
});

test("a worker that cannot be reached is recorded on each uploaded paper, and the upload still stands", async () => {
  const { db, request, owner } = await workspace();
  await waitingRun(db, RUN);
  globalThis.__smallfix2Objects = { [`${OWN}/pending/A/${RUN}/paper.pdf`]: { size: 2048, contentType: "application/pdf" } };
  globalThis.__smallfix2WorkerDown = "connect ECONNREFUSED 10.0.0.7:443";
  const { POST } = await import("../src/app/api/admin/import/finalize/route");
  const response = await POST(
    request("/api/admin/import/finalize", { headers: owner, body: { folderJobId: JOB, uploaded: [{ runId: RUN, storagePath: `gs://${OWN}/pending/A/${RUN}/paper.pdf` }] } })
  );
  assert.equal(response.status, 201);
  const body = (await response.json()) as { queueStart: { trigger: { payload: unknown } }; warning: string };
  assert.deepEqual(body.queueStart.trigger.payload, { reason: "trigger_exception", message: "connect ECONNREFUSED 10.0.0.7:443" });
  assert.equal(body.warning, "Upload succeeded, but processing did not start");
  const run = await db.query<{ status: string; payload: Record<string, unknown> }>(`SELECT status, input_payload AS payload FROM ingestion_runs WHERE id = $1`, [RUN]);
  assert.equal(run.rows[0].status, "queued");
  assert.equal(run.rows[0].payload.worker_trigger_status, "not_started");
  assert.equal(run.rows[0].payload.progress_stage, "queued_but_unstarted");
  assert.deepEqual(run.rows[0].payload.last_worker_trigger_payload, { reason: "trigger_exception", message: "connect ECONNREFUSED 10.0.0.7:443" });
  assert.match(String(run.rows[0].payload.progress_detail), /could not reach the analysis worker/);
});

test("uploads abandoned an hour ago are closed and their files deleted before the account's room is counted", async () => {
  const { db, request, owner } = await workspace();
  // The account is full only of uploads that never finished.
  const abandoned = Array.from({ length: MAX_PAPERS_PER_ACCOUNT }, (_, index) => `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`);
  for (const run of abandoned) {
    await waitingRun(db, run, { minutesAgo: 90 });
    globalThis.__smallfix2Objects![`${OWN}/pending/A/${run}/paper.pdf`] = { size: 2048, contentType: "application/pdf" };
  }
  globalThis.__smallfix2Objects![`${OWN}/pending/A/${RUN}/kept.pdf`] = { size: 2048, contentType: "application/pdf" };
  const { POST } = await import("../src/app/api/admin/import/prepare/route");
  const response = await POST(
    request("/api/admin/import/prepare", { headers: owner, body: { project_id: PROJECT, folder: "A", files: [{ fileIndex: 0, name: "new.pdf", size: 2048, type: "application/pdf", sha256: "e".repeat(64) }] } })
  );
  assert.equal(response.status, 201, "the room was counted after the sweep");
  const failed = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ingestion_runs WHERE status = 'failed' AND error_message = 'The upload was never completed.'`);
  assert.equal(Number(failed.rows[0].n), abandoned.length);
  assert.deepEqual(Object.keys(globalThis.__smallfix2Objects!), [`${OWN}/pending/A/${RUN}/kept.pdf`], "each abandoned upload's file is deleted, and only those");
  const globs = calls().filter((call) => call.op === "getFiles").map((call) => call.options?.matchGlob);
  assert.equal(globs.length, abandoned.length);
  assert.ok(globs.includes(`pending/**/${abandoned[0]}/**`));
});

test("a run id that is not one is never put into a storage glob", async () => {
  await workspace();
  const { deleteRunUploads } = await import("../src/lib/gcs-signed-urls");
  globalThis.__smallfix2Objects = { [`${OWN}/pending/A/${RUN}/paper.pdf`]: { size: 1, contentType: "application/pdf" } };
  for (const bad of ["*", "**", `${RUN}/../..`, "", "not-a-run"]) assert.equal(await deleteRunUploads(bad), 0, bad);
  assert.deepEqual(calls(), []);
  assert.equal(await deleteRunUploads(RUN), 1);
  assert.deepEqual(Object.keys(globalThis.__smallfix2Objects), []);
});

test("an upload link is renewed only for the owner's own run still waiting for its file, and only its object", async () => {
  const { db, request, owner, other } = await workspace();
  const runs = {
    fresh: RUN,
    old: "22222222-2222-4222-8222-222222222222",
    stored: "33333333-3333-4333-8333-333333333333",
    trashed: "44444444-4444-4444-8444-444444444444",
  };
  await waitingRun(db, runs.fresh);
  await waitingRun(db, runs.old, { minutesAgo: 61 });
  await waitingRun(db, runs.stored, { sourcePath: `gs://${OWN}/pending/A/${runs.stored}/paper.pdf` });
  await waitingRun(db, runs.trashed, { trashed: true });
  const { POST } = await import("../src/app/api/admin/import/renew/route");
  const renew = (headers: Record<string, string>, runId: string, storagePath = `gs://${OWN}/pending/A/${runId}/paper.pdf`) =>
    POST(request("/api/admin/import/renew", { headers, body: { folderJobId: JOB, runId, storagePath } }));

  const renewed = await renew(owner, runs.fresh);
  assert.equal(renewed.status, 200);
  assert.equal(((await renewed.json()) as { signedUrl: string }).signedUrl, `https://storage.test/${OWN}/pending/A/${runs.fresh}/paper.pdf?action=write`);
  assert.equal((await renew(other, runs.fresh)).status, 404, "another person's upload");
  for (const run of [runs.old, runs.stored, runs.trashed]) assert.equal((await renew(owner, run)).status, 404, run);
  assert.equal((await renew(owner, runs.fresh, `gs://${OWN}/pending/A/${runs.old}/paper.pdf`)).status, 400, "another run's object");
  assert.equal((await renew(owner, runs.fresh, `gs://uploads-production/pending/A/${runs.fresh}/paper.pdf`)).status, 400, "another bucket");
  assert.equal(calls().filter((call) => call.op === "getSignedUrl").length, 1, "one link signed in all");
});

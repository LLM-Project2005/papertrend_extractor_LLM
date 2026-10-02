import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import { bulkUpdateRunsIn, LibraryActionError } from "../src/lib/cloudsql/library-repository";
import { accountPaperUsageIn, createUploadBatchIn, UploadPolicyError } from "../src/lib/cloudsql/ingestion-repository";
import { pendingObjectName } from "../src/lib/pending-upload-path";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { putWithFreshUrl, UPLOAD_URL_RENEW_AFTER_MS, UploadRefusedError } from "../src/lib/upload-retry";
import { MAX_PAPERS_PER_ACCOUNT } from "../src/lib/upload-safety";

/** Library bulk actions, uploads that skip duplicates, the cap shown first, and upload links that last (docs/32, 4.5). */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const FOLDER_A = "00000000-0000-0000-0000-0000000000f1";
const FOLDER_B = "00000000-0000-0000-0000-0000000000f2";
const OTHER_FOLDER = "00000000-0000-0000-0000-0000000000f9";
const RUNS = ["1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51", "2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52", "3a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c53"];
const OTHER_RUN = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

async function database() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await db.exec(read("cloudsql/schema.sql"));
  const client = { query: (text: string, params?: unknown[]) => db.query(text, params) } as never;
  await db.exec(`
    INSERT INTO user_profiles (id, email) VALUES ('${OWNER}', 'owner@example.edu'), ('${OTHER}', 'other@example.edu');
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-0000-0000-0000000000c9', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'Repository A', '{}'::jsonb, 2, 'test', now()),
      ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', '${OWNER}', 'Repository B', '{}'::jsonb, 2, 'test', now()),
      ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000c9', '${OTHER}', 'Theirs', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES
      ('${FOLDER_A}', '${OWNER}', 'A', '00000000-0000-0000-0000-0000000000a1'),
      ('${FOLDER_B}', '${OWNER}', 'B', '00000000-0000-0000-0000-0000000000a2'),
      ('${OTHER_FOLDER}', '${OTHER}', 'Z', '00000000-0000-0000-0000-0000000000a9');
  `);
  for (const run of RUNS) {
    await db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, file_size_bytes, input_payload)
       VALUES ($1, $2, $3, 'upload', 'succeeded', $4, 1000, '{}'::jsonb)`,
      [run, OWNER, FOLDER_A, `paper-${run.slice(-1)}.pdf`]
    );
    const paper = paperIdFromRunId(run);
    await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [paper, OWNER, FOLDER_A, `Paper ${run.slice(-1)}`]);
    await db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract) VALUES ($1, $2, $3, $4, 'a')`, [paper, OWNER, FOLDER_A, run]);
    await db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, 'T', 'k')`, [paper, OWNER, FOLDER_A]);
  }
  await db.query(
    `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, input_payload) VALUES ($1, $2, $3, 'upload', 'succeeded', '{}'::jsonb)`,
    [OTHER_RUN, OTHER, OTHER_FOLDER]
  );
  return { db, client };
}

/* ------------------------------------------------------------ bulk actions */

test("a selection goes to Trash and comes back in one step; another owner's paper is never touched", async () => {
  const { db, client } = await database();
  const trashed = await bulkUpdateRunsIn(client, OWNER, { action: "trash", runIds: [...RUNS.slice(0, 2), OTHER_RUN] });
  assert.equal(trashed.runs.length, 2);
  assert.equal(trashed.skipped, 1, "the other owner's run is skipped, not trashed");
  const other = await db.query<{ trashed_at: string | null }>(`SELECT trashed_at FROM ingestion_runs WHERE id = $1`, [OTHER_RUN]);
  assert.equal(other.rows[0].trashed_at, null);
  // Trashing again changes nothing; restoring brings both back.
  assert.equal((await bulkUpdateRunsIn(client, OWNER, { action: "trash", runIds: RUNS.slice(0, 2) })).runs.length, 0);
  const restored = await bulkUpdateRunsIn(client, OWNER, { action: "restore", runIds: RUNS });
  assert.equal(restored.runs.length, 2);
  assert.equal(restored.skipped, 1, "the paper that was never in Trash");
  const left = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ingestion_runs WHERE trashed_at IS NOT NULL`);
  assert.equal(left.rows[0].n, "0");
  await db.close();
});

test("a selection moves to another repository with its analysis; a folder that isn't the owner's is refused", async () => {
  const { db, client } = await database();
  const moved = await bulkUpdateRunsIn(client, OWNER, { action: "move", runIds: RUNS, folderId: FOLDER_B });
  assert.equal(moved.runs.length, 3);
  const runs = await db.query<{ folder_id: string; project: string }>(
    `SELECT folder_id::text, input_payload->>'project_id' AS project FROM ingestion_runs WHERE id = ANY($1::uuid[])`,
    [RUNS]
  );
  assert.ok(runs.rows.every((row) => row.folder_id === FOLDER_B && row.project === "00000000-0000-0000-0000-0000000000a2"));
  const rows = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM paper_keywords WHERE folder_id = $1`, [FOLDER_B]);
  assert.equal(rows.rows[0].n, "3", "each paper's analysis rows moved with it");
  // Already there: skipped. A trashed paper stays put.
  assert.equal((await bulkUpdateRunsIn(client, OWNER, { action: "move", runIds: RUNS, folderId: FOLDER_B })).skipped, 3);
  await assert.rejects(
    bulkUpdateRunsIn(client, OWNER, { action: "move", runIds: RUNS, folderId: OTHER_FOLDER }),
    (error: unknown) => error instanceof LibraryActionError && error.status === 404
  );
  await assert.rejects(
    bulkUpdateRunsIn(client, OWNER, { action: "move", runIds: RUNS }),
    (error: unknown) => error instanceof LibraryActionError && error.status === 400
  );
  await db.close();
});

test("the Library selects, and acts on, only what is in view", () => {
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /aria-label="Select every file shown"/);
  assert.match(library, /aria-label=\{`Select \$\{item\.name\}`\}/);
  assert.match(library, /visibleEntries\.filter\(\(entry\) => selectedRunIds\.has\(entry\.run\.id\)\)/);
  for (const action of ["Move to Trash", "Restore", "Delete permanently…", "Move…", "Analyze again (", "Try again ("]) {
    assert.ok(library.includes(action), action);
  }
  assert.match(library, /void runBulk\("trash", selectedRuns\)/);
  assert.match(library, /setDeleteTarget\(\{ runs: selectedRuns, all: false \}\)/);
  assert.match(library, /run\.status === "failed" && !run\.trashed_at && Boolean\(run\.source_path\)/);
  // The Source filter is offered once a paper came from Drive (LIB-7).
  assert.match(library, /run\.input_payload\?\.import_source === "google-drive"/);
  assert.match(library, /fileEntries\.some\(\(entry\) => entry\.sourceFilter === "google-drive"\)/);
});

/* ------------------------------------------------------------------ uploads */

const batch = (files: Array<{ name: string; size?: number; sha256?: string | null; driveFileId?: string | null }>) => ({
  ownerUserId: OWNER,
  projectId: "00000000-0000-0000-0000-0000000000a1",
  folderId: FOLDER_A,
  files: files.map((file) => ({ size: 2000, type: "application/pdf", ...file })),
  folderName: "Repository A",
  sourceKind: "pdf-upload",
  provider: "auto",
  model: "auto",
  analysisLabel: "auto",
});

test("a duplicate is left out with its reason, and the rest of the batch uploads", async () => {
  const { db, client } = await database();
  const known = "a".repeat(64);
  await db.query(
    `INSERT INTO file_fingerprints (owner_user_id, sha256, file_size_bytes, source_filename, latest_run_id) VALUES ($1, $2, 1000, 'paper-1.pdf', $3)`,
    [OWNER, known, RUNS[0]]
  );
  const result = await createUploadBatchIn(
    client,
    batch([
      { name: "new.pdf", sha256: "b".repeat(64), driveFileId: "1AbCdEfGhIjKlMnOp" },
      { name: "renamed copy.pdf", sha256: known },
      { name: "new again.pdf", sha256: "b".repeat(64) },
      { name: "paper-2.pdf", size: 1000, sha256: null },
      { name: "fresh.pdf", sha256: "c".repeat(64) },
    ])
  );
  assert.deepEqual(result.acceptedPositions, [0, 4]);
  assert.deepEqual(
    result.skipped.map((skip) => [skip.position, skip.reason]),
    [
      [1, 'Already analyzed in this account as "paper-1.pdf".'],
      [2, "It was chosen more than once; one copy is uploaded."],
      [3, 'Already analyzed in this account as "paper-2.pdf".'],
    ]
  );
  assert.equal(result.runs.length, 2);
  assert.equal(result.runs[0].input_payload?.import_source, "google-drive");
  assert.equal(result.runs[0].input_payload?.drive_file_id, "1AbCdEfGhIjKlMnOp");
  assert.equal(result.runs[0].input_payload?.source_kind, "pdf-upload", "never the connector's source_kind");
  assert.equal(result.runs[1].input_payload?.import_source, "computer");
  assert.equal(Number(result.folderJob.total_runs), 2);
  // Each accepted file's fingerprint now names its new run, for the next upload's check.
  const recorded = await db.query<{ latest_run_id: string }>(`SELECT latest_run_id::text FROM file_fingerprints WHERE owner_user_id = $1 AND sha256 = $2`, [OWNER, "c".repeat(64)]);
  assert.equal(recorded.rows[0]?.latest_run_id, result.runs[1].id);


  // Nothing new at all: refused, every file listed.
  await assert.rejects(createUploadBatchIn(client, batch([{ name: "x.pdf", sha256: known }])), (error: unknown) => {
    assert.ok(error instanceof UploadPolicyError);
    assert.equal(error.status, 409);
    assert.equal(error.skipped.length, 1);
    return true;
  });
  // A fingerprint whose run failed is not a paper in the account: that file goes ahead.
  await db.query(`UPDATE ingestion_runs SET status = 'failed' WHERE id = $1`, [RUNS[0]]);
  const retried = await createUploadBatchIn(client, batch([{ name: "renamed copy.pdf", sha256: known }]));
  assert.deepEqual(retried.acceptedPositions, [0], "only a succeeded paper with content counts as already analysed");
  await db.query(`UPDATE ingestion_runs SET status = 'succeeded' WHERE id = $1`, [RUNS[0]]);
  await db.close();
});

test("the account's room counts stored papers and uploads under way; a skipped file takes none", async () => {
  const { db, client } = await database();
  assert.deepEqual(await accountPaperUsageIn(client, OWNER), { used: 3, limit: MAX_PAPERS_PER_ACCOUNT, exempt: false });
  for (let index = 3; index < MAX_PAPERS_PER_ACCOUNT - 1; index += 1) {
    await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2020', 'filler')`, [String(5_000_000 + index), OWNER, FOLDER_A]);
  }
  // One place left: a duplicate plus one new file fits; two new files do not.
  const known = "d".repeat(64);
  await db.query(`INSERT INTO file_fingerprints (owner_user_id, sha256, source_filename, latest_run_id) VALUES ($1, $2, 'paper-1.pdf', $3)`, [OWNER, known, RUNS[0]]);
  await assert.rejects(
    createUploadBatchIn(client, batch([{ name: "one.pdf", sha256: "e".repeat(64) }, { name: "two.pdf", sha256: "f".repeat(64) }])),
    (error: unknown) => error instanceof UploadPolicyError && error.status === 429
  );
  const fits = await createUploadBatchIn(client, batch([{ name: "dup.pdf", sha256: known }, { name: "one.pdf", sha256: "e".repeat(64) }]));
  assert.equal(fits.runs.length, 1);
  assert.equal((await accountPaperUsageIn(client, OWNER)).used, MAX_PAPERS_PER_ACCOUNT, "the upload under way counts");
  await db.query(`UPDATE user_profiles SET role = 'admin' WHERE id = $1`, [OWNER]);
  assert.equal((await accountPaperUsageIn(client, OWNER)).exempt, true);
  // An admin is not held to the cap; their uploads are still counted.
  const past = await createUploadBatchIn(client, batch([{ name: "two.pdf", sha256: "f".repeat(64) }, { name: "three.pdf", sha256: "a".repeat(64) }]));
  assert.equal(past.runs.length, 2);
  assert.equal((await accountPaperUsageIn(client, OWNER)).used, MAX_PAPERS_PER_ACCOUNT + 2);
  await db.close();
});

test("the upload dialog shows the room, sends where a file came from, and renews its links", () => {
  const modal = read("src/components/workspace/AnalyzeFlowModal.tsx");
  assert.match(modal, /fetch\("\/api\/workspace\/library\/room"/);
  assert.match(modal, /Room for \$\{plural\(room\.remaining, "more paper"\)\}/);
  assert.match(modal, /drive_file_id: driveFileIdOf\(file\)/);
  assert.match(modal, /await putWithFreshUrl\(/);
  assert.match(modal, /fetch\("\/api\/admin\/import\/renew"/);
  assert.match(modal, /skipped: skipped\.map/);
  assert.match(read("src/lib/google-drive-picker.ts"), /driveFileIds\.set\(file, document\.id\)/);
});

/* --------------------------------------------------------- links that last */

test("a link near its expiry is renewed before use, and a refused one is renewed once", async () => {
  const calls: string[] = [];
  const put = async (url: string) => {
    calls.push(url);
    if (url === "expired") throw new UploadRefusedError("ExpiredToken", 400);
  };
  let renewals = 0;
  const renew = async () => {
    renewals += 1;
    return { signedUrl: `fresh-${renewals}` };
  };
  const headers = () => ({});
  const now = 10_000_000;
  // Fresh: used as is.
  await putWithFreshUrl({ signedUrl: "ok", signedAt: now - 60_000 }, new Blob(["x"]), headers, renew, { now: () => now, put });
  assert.deepEqual(calls, ["ok"]);
  // Old: renewed before the upload.
  const renewed = await putWithFreshUrl({ signedUrl: "old", signedAt: now - UPLOAD_URL_RENEW_AFTER_MS - 1 }, new Blob(["x"]), headers, renew, { now: () => now, put });
  assert.equal(renewed.signedUrl, "fresh-1");
  // Refused as expired: renewed once and retried.
  await putWithFreshUrl({ signedUrl: "expired", signedAt: now }, new Blob(["x"]), headers, renew, { now: () => now, put });
  assert.deepEqual(calls.slice(-2), ["expired", "fresh-2"]);
  // Any other failure is not retried with a new link.
  await assert.rejects(
    putWithFreshUrl({ signedUrl: "down", signedAt: now }, new Blob(["x"]), headers, renew, {
      now: () => now,
      put: async () => {
        throw new Error("network");
      },
    }),
    /network/
  );
  assert.equal(renewals, 2);
});

test("only the object a pending upload was signed for is signed again", () => {
  const run = "11111111-2222-4333-8444-555555555555";
  assert.equal(pendingObjectName(`gs://uploads/pending/Repo/${run}/a.pdf`, run, "uploads"), `pending/Repo/${run}/a.pdf`);
  assert.equal(pendingObjectName(`gs://elsewhere/pending/Repo/${run}/a.pdf`, run, "uploads"), null, "another bucket");
  assert.equal(pendingObjectName(`gs://uploads/pending/Repo/other-run/a.pdf`, run, "uploads"), null, "another run");
  assert.equal(pendingObjectName(`gs://uploads/pending/Repo/${run}/../../papers/x.pdf`, run, "uploads"), null);
  assert.equal(pendingObjectName(`gs://uploads/papers/${run}/a.pdf`, run, "uploads"), null, "not a pending upload");
  const renew = read("src/app/api/admin/import/renew/route.ts");
  assert.match(renew, /cloudSqlIngestionRepository\.pendingUploadRun\(user\.id, folderJobId, runId\)/);
  assert.match(read("src/lib/cloudsql/ingestion-repository.ts"), /AND source_path IS NULL AND trashed_at IS NULL\s*AND created_at > now\(\) - interval '60 minutes'/);
});

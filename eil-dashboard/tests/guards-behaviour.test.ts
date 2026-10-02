/*
 * Spend guards, run rather than read (docs/32, long-term health): the daily
 * usage limit, the re-analysis cap and the abandoned-upload sweep, against
 * PGlite under the app's role (tests/support/route-harness.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const OTHER_FOLDER = "00000000-0000-4000-8000-0000000000f9";

async function people(env: Record<string, string> = {}) {
  const harness = await routeHarness({ AI_DAILY_MESSAGE_LIMIT: "3", AI_DAILY_WEB_SEARCH_LIMIT: "2", ...env });
  await harness.signIn(OWNER);
  await harness.signIn(OTHER);
  await harness.signIn(ADMIN, { role: "admin" });
  await harness.db.exec(`
    INSERT INTO research_folders (id, owner_user_id, name) VALUES ('${FOLDER}', '${OWNER}', 'A'), ('${OTHER_FOLDER}', '${OTHER}', 'Z');
  `);
  return harness;
}

async function outcome(work: Promise<unknown>): Promise<number> {
  try {
    await work;
    return 200;
  } catch (error) {
    return (error as { status?: number }).status ?? 500;
  }
}

/* --------------------------------------------------------- daily limits */

test("the daily limit refuses each person's request past it, per kind, and an admin is not counted", async () => {
  const { db } = await people();
  const { assertAndRecordAiUsage } = await import("../src/lib/security-guards");
  // Five at once: three pass, two are refused. (PGlite has one connection, so
  // this shows the count, not the lock that keeps parallel requests honest on
  // Cloud SQL; that lock is pinned in security-batch4.)
  const statuses = await Promise.all(Array.from({ length: 5 }, () => outcome(assertAndRecordAiUsage(OWNER, "chat_message"))));
  assert.deepEqual(statuses.sort(), [200, 200, 200, 429, 429]);
  const recorded = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ai_usage_events WHERE owner_user_id = $1`, [OWNER]);
  assert.equal(recorded.rows[0].count, 3, "a refused request records nothing");

  assert.equal(await outcome(assertAndRecordAiUsage(OTHER, "chat_message")), 200, "another person has their own count");
  assert.equal(await outcome(assertAndRecordAiUsage(OWNER, "web_search")), 200, "each kind has its own count");
  assert.equal(await outcome(assertAndRecordAiUsage(OWNER, "web_search")), 200);
  assert.equal(await outcome(assertAndRecordAiUsage(OWNER, "web_search")), 429, "web search stops at its own limit");
  for (let i = 0; i < 5; i += 1) assert.equal(await outcome(assertAndRecordAiUsage(ADMIN, "chat_message")), 200, "an admin is exempt");
  const metered = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ai_usage_events WHERE owner_user_id = $1`, [ADMIN]);
  assert.equal(metered.rows[0].count, 5, "but still metered");

  // Yesterday's use does not count today.
  await db.query(`UPDATE ai_usage_events SET created_at = now() - interval '2 days' WHERE owner_user_id = $1`, [OWNER]);
  assert.equal(await outcome(assertAndRecordAiUsage(OWNER, "chat_message")), 200);
});

test("a limit that cannot be checked refuses the request instead of letting it through", async () => {
  const { db } = await people();
  const { assertAndRecordAiUsage } = await import("../src/lib/security-guards");
  // The spend can be read, but the use cannot be recorded.
  await db.exec(`REVOKE INSERT ON ai_usage_events FROM papertrend_app`);
  await assert.rejects(assertAndRecordAiUsage(OWNER, "chat_message"), (error: { status?: number; message?: string }) => {
    assert.equal(error.status, 503);
    assert.equal(error.message, "Usage could not be checked just now. Try again in a moment.");
    return true;
  });
  // Nor can it be read.
  await db.exec(`REVOKE SELECT ON ai_usage_events FROM papertrend_app`);
  assert.equal(await outcome(assertAndRecordAiUsage(OWNER, "deep_research")), 503);
});

/* ---------------------------------------------------- re-analysis cap */

test("a paper is analysed again at most three times a (UTC) day, and only the owner's own", async () => {
  const { db } = await people();
  const { cloudSqlAnalysisJobRepository, MAX_REANALYSES_PER_PAPER_PER_DAY } = await import("../src/lib/cloudsql/analysis-job-repository");
  assert.equal(MAX_REANALYSES_PER_PAPER_PER_DAY, 3);
  const run = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
  const theirs = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  for (const [id, owner, folder] of [[run, OWNER, FOLDER], [theirs, OTHER, OTHER_FOLDER]]) {
    await db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_path, input_payload)
       VALUES ($1, $2, $3, 'upload', 'succeeded', 'papers/x.pdf', '{}'::jsonb)`,
      [id, owner, folder]
    );
  }
  const finish = () => db.query(`UPDATE ingestion_runs SET status = 'succeeded' WHERE id = $1`, [run]);
  const queued: string[][] = [];
  for (let i = 0; i < 4; i += 1) {
    queued.push(await cloudSqlAnalysisJobRepository.queueReanalysis(OWNER, { runIds: [run, theirs] }));
    await finish();
  }
  assert.deepEqual(queued, [[run], [run], [run], []], "three times, then refused; never the other owner's run");
  const payload = await db.query<{ input_payload: Record<string, unknown> }>(`SELECT input_payload FROM ingestion_runs WHERE id = $1`, [run]);
  assert.equal(payload.rows[0].input_payload.reanalysis_day_count, 3);
  assert.equal(payload.rows[0].input_payload.reanalysis_count, 3);

  // A new day starts a new count; the lifetime count carries on.
  await db.query(`UPDATE ingestion_runs SET input_payload = input_payload || '{"reanalysis_day": "2000-01-01"}'::jsonb WHERE id = $1`, [run]);
  assert.deepEqual(await cloudSqlAnalysisJobRepository.queueReanalysis(OWNER, { runIds: [run] }), [run]);
  const next = await db.query<{ input_payload: Record<string, unknown> }>(`SELECT input_payload FROM ingestion_runs WHERE id = $1`, [run]);
  assert.equal(next.rows[0].input_payload.reanalysis_day_count, 1);
  assert.equal(next.rows[0].input_payload.reanalysis_count, 4);
  const untouched = await db.query<{ status: string }>(`SELECT status FROM ingestion_runs WHERE id = $1`, [theirs]);
  assert.equal(untouched.rows[0].status, "succeeded");
});

/* ------------------------------------------------ abandoned uploads */

test("the upload sweep fails only the caller's own uploads that were never finished, after the wait", async () => {
  const { db } = await people();
  const { cloudSqlIngestionRepository } = await import("../src/lib/cloudsql/ingestion-repository");
  const rows: Array<[string, string, string, string, string | null, string]> = [
    ["00000000-0000-4000-8000-000000000101", OWNER, "upload", "processing", null, "2 hours"], // abandoned
    ["00000000-0000-4000-8000-000000000102", OWNER, "upload", "processing", null, "5 minutes"], // still uploading
    ["00000000-0000-4000-8000-000000000103", OWNER, "upload", "processing", "papers/x.pdf", "2 hours"], // finalized
    ["00000000-0000-4000-8000-000000000104", OWNER, "upload", "succeeded", null, "2 hours"], // finished
    ["00000000-0000-4000-8000-000000000105", OWNER, "batch", "processing", null, "2 hours"], // a batch import, not an upload
    ["00000000-0000-4000-8000-000000000106", OTHER, "upload", "processing", null, "2 hours"], // someone else's
  ];
  for (const [id, owner, source, status, path, age] of rows) {
    await db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_path, input_payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, now() - $7::interval)`,
      [id, owner, owner === OWNER ? FOLDER : OTHER_FOLDER, source, status, path, age]
    );
  }
  assert.deepEqual(await cloudSqlIngestionRepository.failAbandonedUploads(OWNER, 60), ["00000000-0000-4000-8000-000000000101"]);
  const after = await db.query<{ id: string; status: string; error_message: string | null }>(`SELECT id, status, error_message FROM ingestion_runs ORDER BY id`);
  assert.deepEqual(
    after.rows.map((row) => row.status),
    ["failed", "processing", "processing", "succeeded", "processing", "processing"]
  );
  assert.equal(after.rows[0].error_message, "The upload was never completed.");
  assert.deepEqual(await cloudSqlIngestionRepository.failAbandonedUploads(OWNER, 60), [], "running it again changes nothing");
});

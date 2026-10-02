import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CANCEL_RUNS_SQL } from "../src/lib/cloudsql/analysis-job-repository";
import { hasUsableAnalysis, usableAnalysisSql } from "../src/lib/usable-analysis";

/** Re-analysis does not take a paper out of chat or the semantic map; cancel restores it (docs/32, 2.4). */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CASES = JSON.parse(read("tests/fixtures/usable-analysis-cases.json")) as Array<{
  name: string; status: string; input_payload: Record<string, unknown>; usable: boolean;
}>;

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE ingestion_runs (
      id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, status text NOT NULL, error_message text,
      completed_at timestamptz, updated_at timestamptz, input_payload jsonb NOT NULL DEFAULT '{}');
  `);
  return db;
}
const runId = (n: number) => `00000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
const OWNER = "00000000-0000-0000-0000-00000000000a";

test("the rule in TypeScript and in SQL agree on every case", async () => {
  const db = await database();
  for (const [index, item] of CASES.entries()) {
    assert.equal(hasUsableAnalysis(item), item.usable, item.name);
    await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, status, input_payload) VALUES ($1,$2,$3,$4)`, [runId(index), OWNER, item.status, item.input_payload]);
  }
  const usable = await db.query<{ id: string }>(`SELECT id FROM ingestion_runs ir WHERE ${usableAnalysisSql("ir")} ORDER BY id`);
  assert.deepEqual(usable.rows.map((row) => row.id), CASES.flatMap((item, index) => (item.usable ? [runId(index)] : [])));
  assert.equal(hasUsableAnalysis(null), false);
  await db.close();
});

test("canceling a re-analysis restores the earlier analysis; canceling a first analysis fails it", async () => {
  const db = await database();
  const other = "00000000-0000-0000-0000-00000000000b";
  const reanalysis = { reanalysis_requested_at: "2026-10-01T00:00:00Z", paper_id: "123", analysis_metrics: { completed_at: "2026-09-30T10:00:00Z" }, progress_stage: "queued" };
  await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, status, input_payload) VALUES
    ($1,$4,'processing',$5), ($2,$4,'queued','{}'), ($3,$6,'processing',$5)`, [runId(1), runId(2), runId(3), OWNER, reanalysis, other]);
  const now = "2026-10-01T01:00:00Z";
  const canceled = await db.query<{ id: string; status: string; error_message: string | null; completed_at: Date; input_payload: Record<string, unknown> }>(
    CANCEL_RUNS_SQL,
    [OWNER, [runId(1), runId(2), runId(3)], now, JSON.stringify({ progress_stage: "failed", canceled_by_user: true }), JSON.stringify({ progress_stage: "completed", reanalysis_canceled_at: now })]
  );
  const byId = new Map(canceled.rows.map((row) => [row.id, row]));
  assert.equal(byId.size, 2, "another owner's run is untouched");
  const restored = byId.get(runId(1))!;
  assert.equal(restored.status, "succeeded");
  assert.equal(restored.error_message, null);
  assert.equal(new Date(restored.completed_at).toISOString(), "2026-09-30T10:00:00.000Z", "its earlier completion time");
  assert.equal(restored.input_payload.progress_stage, "completed");
  assert.equal(restored.input_payload.reanalysis_canceled_at, now);
  assert.equal((restored.input_payload.analysis_metrics as { completed_at: string }).completed_at, "2026-09-30T10:00:00Z", "the earlier analysis stays described");
  const failed = byId.get(runId(2))!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_message, "Canceled by user.");
  assert.equal(failed.input_payload.canceled_by_user, true);
  const untouched = await db.query<{ status: string }>(`SELECT status FROM ingestion_runs WHERE id=$1`, [runId(3)]);
  assert.equal(untouched.rows[0].status, "processing");
  await db.close();
});

test("chat, the semantic map and the Library read a paper being re-analysed", () => {
  const chat = read("src/lib/repository-chat.ts");
  const loader = chat.slice(chat.indexOf("async function loadCloudSqlRows("), chat.indexOf("const paperIds = paperResult.rows.map"));
  assert.match(loader, /AND \$\{usableAnalysisSql\("ir"\)\}\s+ORDER BY p\.title ASC/);
  assert.doesNotMatch(loader, /AND ir\.status = 'succeeded'\s+ORDER BY/);
  const map = read("src/lib/semantic-map-repository.ts");
  assert.match(map, /AND \$\{usableAnalysisSql\("ir"\)\} AND ir\.trashed_at IS NULL/);
  assert.match(map, /WHERE \$\{usableAnalysisSql\("sr"\)\}/);
  assert.match(read("src/components/chat/ChatClient.tsx"), /runsInTransfer\(rows, transfer\)\.filter\(\(run\) => hasUsableAnalysis\(run\)\)/);
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.equal((library.match(/hasUsableAnalysis\(activeMenuRun\)/g) ?? []).length, 2, "View analysis and Download report");
  assert.match(library, /if \(hasUsableAnalysis\(run\)\) \{\s*await handleViewAnalysis/);
  // Analysing again stays for finished papers only.
  assert.match(library, /activeMenuRun\.status === "succeeded" && !activeMenuRun\.trashed_at/);
});

test("Cancel all cancels the batch in view, never every run the person has", () => {
  const route = read("src/app/api/folder-analysis/cancel-all/route.ts");
  const guard = route.indexOf("if (!folderJobId && runIds.length === 0)");
  assert.ok(guard > 0 && guard < route.indexOf("cloudSqlAnalysisJobRepository."), "refused before any database work");
  assert.match(route, /status: 400/);
  for (const caller of ["src/components/workspace/WorkspaceShell.tsx", "src/components/workspace/WorkspaceHomeClient.tsx"]) {
    assert.match(read(caller), /cancelAllActiveRuns\(\{\s*folderJobId: analysisSession\?\.folderJobId \?\? undefined,\s*runIds: analysisSession\?\.runIds,\s*\}\)/, caller);
  }
});

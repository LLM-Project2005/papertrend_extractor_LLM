/*
 * The pilot and production share one database (docs/32, 1.1). The gate and
 * what each deployment writes on a run run against PGlite under the app's
 * role (tests/support/route-harness.ts); the build files are read as config.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { deploymentAdmits, deploymentEnv, PILOT_RESTRICTED_MESSAGE, pilotAllowedEmails } from "../src/lib/deployment";
import { routeHarness } from "./support/route-harness";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const OWNER = "00000000-0000-4000-8000-00000000000a";
const STRANGER = "00000000-0000-4000-8000-00000000000b";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  let result: T;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }
  // An async check keeps its environment until it settles.
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}

test("a server is production unless told it is the pilot", () => {
  withEnv({ DEPLOYMENT_ENV: undefined }, () => assert.equal(deploymentEnv(), "production"));
  withEnv({ DEPLOYMENT_ENV: "PILOT" }, () => assert.equal(deploymentEnv(), "pilot"));
  withEnv({ DEPLOYMENT_ENV: "staging" }, () => assert.equal(deploymentEnv(), "production"));
});

test("production admits everyone; the pilot admits only listed emails and admins", () => {
  withEnv({ PILOT_ALLOWED_EMAILS: "Owner@Example.com, tester@example.com" }, () => {
    assert.deepEqual(pilotAllowedEmails(), ["owner@example.com", "tester@example.com"]);
    assert.equal(deploymentAdmits({ email: "stranger@example.com" }, "production"), true);
    assert.equal(deploymentAdmits({ email: "tester@example.com" }, "pilot"), true);
    assert.equal(deploymentAdmits({ email: "TESTER@example.com" }, "pilot"), true, "case does not matter");
    assert.equal(deploymentAdmits({ email: "stranger@example.com", role: "admin" }, "pilot"), true);
    assert.equal(deploymentAdmits({ email: "stranger@example.com", role: "user" }, "pilot"), false);
    assert.equal(deploymentAdmits({ email: null }, "pilot"), false);
  });
  withEnv({ PILOT_ALLOWED_EMAILS: undefined }, () => assert.equal(deploymentAdmits({ email: "anyone@example.com" }, "pilot"), false));
});

test("a refused pilot sign-in carries no owner, so every route refuses it", async () => {
  const harness = await routeHarness({ DEPLOYMENT_ENV: "pilot", PILOT_ALLOWED_EMAILS: "owner@papertrend.test" });
  const { applyDeploymentGate, clearVerifiedIdentities } = await import("../src/lib/auth/adapter");
  const identity = { provider: "firebase" as const, subject: "s", email: "x@example.com", claims: {}, userMetadata: {}, ownerUserId: null };
  // No owner yet: nothing to gate, and nothing to look up.
  assert.deepEqual(await applyDeploymentGate(identity), identity);
  await withEnv({ DEPLOYMENT_ENV: "production" }, async () => {
    const owned = { ...identity, ownerUserId: "00000000-0000-0000-0000-000000000001" };
    assert.deepEqual(await applyDeploymentGate(owned), owned, "production is never gated");
  });

  const owner = await harness.signIn(OWNER, { email: "owner@papertrend.test" });
  const stranger = await harness.signIn(STRANGER, { email: "stranger@papertrend.test" });
  const { GET: profile } = await import("../src/app/api/auth/profile/route");
  const { GET: projects } = await import("../src/app/api/workspace/projects/route");
  const ask = async (route: (request: Request) => Promise<Response>, path: string, headers: Record<string, string>) => {
    clearVerifiedIdentities();
    const quiet = mock.method(console, "warn", () => undefined);
    const response = await route(harness.request(path, { headers })).finally(() => quiet.mock.restore());
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  assert.deepEqual(await ask(profile, "/api/auth/profile", stranger), { status: 403, body: { error: PILOT_RESTRICTED_MESSAGE, code: "pilot_restricted" } });
  assert.equal((await ask(projects, "/api/workspace/projects", stranger)).status, 401, "another route refuses it too");
  const admitted = await ask(profile, "/api/auth/profile", owner);
  assert.equal(admitted.status, 200);
  assert.equal(admitted.body.ownerUserId, OWNER, "a listed email is let in");
  assert.equal((await ask(projects, "/api/workspace/projects", owner)).status, 200);
});

test("every path that queues a run records the deployment, and recovery takes only its own", async () => {
  const harness = await routeHarness({ DEPLOYMENT_ENV: "production" });
  await harness.signIn(OWNER);
  const PROJECT = "00000000-0000-4000-8000-0000000000a1";
  const FOLDER = "00000000-0000-4000-8000-0000000000f1";
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'A', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Papers', '${PROJECT}');
  `);
  const { cloudSqlIngestionRepository } = await import("../src/lib/cloudsql/ingestion-repository");
  const { cloudSqlAnalysisJobRepository } = await import("../src/lib/cloudsql/analysis-job-repository");
  const deployment = async (runId: string) =>
    (await harness.db.query<{ deployment: string | null }>(`SELECT input_payload->>'deployment' AS deployment FROM ingestion_runs WHERE id = $1`, [runId])).rows[0].deployment;
  const as = <T,>(env: "pilot" | "production", work: () => Promise<T>) => withEnv({ DEPLOYMENT_ENV: env }, work);

  // A new upload, and its finalisation, each name the deployment that handled them.
  const batch = await as("pilot", () =>
    cloudSqlIngestionRepository.createUploadBatch({
      ownerUserId: OWNER,
      projectId: PROJECT,
      folderId: FOLDER,
      files: [{ name: "paper.pdf", size: 120_000, type: "application/pdf", sha256: "a".repeat(64) }],
      folderName: "Papers",
      sourceKind: "upload",
      provider: "openai",
      model: "test-model",
      analysisLabel: "General",
    })
  );
  const run = batch.runs[0].id;
  assert.equal(await deployment(run), "pilot", "a new upload");
  await as("production", () =>
    cloudSqlIngestionRepository.finalizeBatch({ ownerUserId: OWNER, folderJobId: batch.folderJob.id, uploaded: [{ runId: run, storagePath: "gs://uploads/paper.pdf" }], failed: [] })
  );
  assert.equal(await deployment(run), "production", "its finalisation");

  await harness.db.query(`UPDATE ingestion_runs SET status = 'succeeded' WHERE id = $1`, [run]);
  assert.deepEqual(await as("pilot", () => cloudSqlAnalysisJobRepository.queueReanalysis(OWNER, { runIds: [run] })), [run]);
  assert.equal(await deployment(run), "pilot", "re-analysis");

  await harness.db.query(`UPDATE ingestion_runs SET status = 'processing' WHERE id = $1`, [run]);
  assert.equal(await as("production", () => cloudSqlAnalysisJobRepository.requeueRuns(OWNER, [run], "stalled")), 1);
  assert.equal(await deployment(run), "production", "requeue");

  // The web's stall recovery takes back only its own deployment's runs; a run
  // from before the key existed is production's.
  const stalled = { pilot: "2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52", unmarked: "3a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c53" };
  await harness.db.query(
    `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, input_payload, updated_at) VALUES
       ($1, $3, $4, 'upload', 'processing', '{"deployment": "pilot"}', now() - interval '2 hours'),
       ($2, $3, $4, 'upload', 'processing', '{}', now() - interval '2 hours')`,
    [stalled.pilot, stalled.unmarked, OWNER, FOLDER]
  );
  const status = async (id: string) => (await harness.db.query<{ status: string }>(`SELECT status FROM ingestion_runs WHERE id = $1`, [id])).rows[0].status;
  const recover = () =>
    cloudSqlAnalysisJobRepository.recoverAll({ staleBefore: new Date(Date.now() - 60 * 60_000).toISOString(), orphanBefore: new Date(0).toISOString(), maxRows: 10 });
  assert.equal((await as("pilot", recover)).requeuedRuns, 1);
  assert.deepEqual([await status(stalled.pilot), await status(stalled.unmarked)], ["queued", "processing"], "the pilot takes its own");
  assert.equal((await as("production", recover)).requeuedRuns, 1);
  assert.equal(await status(stalled.unmarked), "queued", "and production the rest");
});

test("the build files name each deployment", () => {
  assert.match(read("../cloudbuild.web.cloudsql.pilot.yaml"), /DEPLOYMENT_ENV=pilot,/);
  assert.match(read("../cloudbuild.web.cloudsql.pilot.yaml"), /PILOT_ALLOWED_EMAILS=PILOT_ALLOWED_EMAILS:latest/);
  assert.match(read("../cloudbuild.web.production.yaml"), /DEPLOYMENT_ENV=production,/);
  assert.match(read("../cloudbuild.worker.cloudsql.pilot.yaml"), /WORKER_DEPLOYMENT=pilot,/);
  assert.match(read("../cloudbuild.worker.production.yaml"), /WORKER_DEPLOYMENT=production,/);
});

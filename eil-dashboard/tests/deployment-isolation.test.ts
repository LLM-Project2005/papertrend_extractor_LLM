import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deploymentAdmits, deploymentEnv, pilotAllowedEmails } from "../src/lib/deployment";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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
  const { applyDeploymentGate } = await import("../src/lib/auth/adapter");
  const identity = { provider: "firebase" as const, subject: "s", email: "x@example.com", claims: {}, userMetadata: {}, ownerUserId: null };
  await withEnv({ DEPLOYMENT_ENV: "pilot" }, async () => {
    // No owner yet: nothing to gate, and nothing to look up.
    assert.deepEqual(await applyDeploymentGate(identity), identity);
  });
  await withEnv({ DEPLOYMENT_ENV: "production" }, async () => {
    const owned = { ...identity, ownerUserId: "00000000-0000-0000-0000-000000000001" };
    assert.deepEqual(await applyDeploymentGate(owned), owned, "production is never gated");
  });
  const profile = read("src/app/api/auth/profile/route.ts");
  assert.match(profile, /mappingStatus === "pilot_restricted"[\s\S]{0,120}PILOT_RESTRICTED_MESSAGE, code: "pilot_restricted", status: 403/);
});

test("every path that queues a run records the deployment, and recovery takes only its own", () => {
  const ingestion = read("src/lib/cloudsql/ingestion-repository.ts");
  assert.equal((ingestion.match(/\[DEPLOYMENT_KEY\]: deploymentEnv\(\)/g) ?? []).length, 2, "new uploads and their finalisation");
  const jobs = read("src/lib/cloudsql/analysis-job-repository.ts");
  assert.match(jobs, /jsonb_build_object\('deployment', \$\$\{values\.length \+ 6\}::text\)/, "re-analysis");
  assert.match(jobs, /progress_detail: reason, progress_updated_at: new Date\(\)\.toISOString\(\),\s*\[DEPLOYMENT_KEY\]: deploymentEnv\(\),/, "requeue");
  assert.match(jobs, /AND COALESCE\(input_payload->>'deployment', 'production'\) = \$3/, "the web's stall recovery");
  // The build files name each deployment.
  assert.match(read("../cloudbuild.web.cloudsql.pilot.yaml"), /DEPLOYMENT_ENV=pilot,/);
  assert.match(read("../cloudbuild.web.cloudsql.pilot.yaml"), /PILOT_ALLOWED_EMAILS=PILOT_ALLOWED_EMAILS:latest/);
  assert.match(read("../cloudbuild.web.production.yaml"), /DEPLOYMENT_ENV=production,/);
  assert.match(read("../cloudbuild.worker.cloudsql.pilot.yaml"), /WORKER_DEPLOYMENT=pilot,/);
  assert.match(read("../cloudbuild.worker.production.yaml"), /WORKER_DEPLOYMENT=production,/);
});

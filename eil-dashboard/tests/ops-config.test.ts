import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** The step ids of a Cloud Build file, in order. */
function stepIds(yaml: string): string[] {
  return [...yaml.matchAll(/^\s{2}- id: ([\w-]+)\s*$/gm)].map((match) => match[1]);
}

test("every deploy runs its test suite first (docs/32, 1.2)", () => {
  assert.equal(stepIds(read("cloudbuild.web.production.yaml"))[0], "test-web");
  assert.equal(stepIds(read("cloudbuild.web.cloudsql.pilot.yaml"))[0], "test-web");
  assert.equal(stepIds(read("cloudbuild.worker.production.yaml"))[0], "test-python");
  assert.equal(stepIds(read("cloudbuild.worker.cloudsql.pilot.yaml"))[0], "test-python");
  assert.match(read("eil-dashboard/package.json"), /"test": "tsx --test --test-force-exit tests\/\*\.test\.ts"/);
  assert.match(read(".github/workflows/tests.yml"), /pull_request:/);
});

test("production takes traffic only after the new revision answers its health check", () => {
  const web = read("cloudbuild.web.production.yaml");
  assert.deepEqual(stepIds(web), ["test-web", "deploy-web-production-candidate", "smoke-web-production-candidate", "promote-web-production"]);
  assert.match(web, /- --no-traffic\s+- --tag\s+- candidate/);
  assert.match(web, /\$\$url\/api\/health/);
  assert.match(web, /- update-traffic[\s\S]*- --to-latest/);
});

test("background jobs do not share the one-at-a-time ingestion queue (docs/32, 1.4)", () => {
  const production = read("cloudbuild.web.production.yaml");
  const pilot = read("cloudbuild.web.cloudsql.pilot.yaml");
  assert.match(production, /_REPOSITORY_CHAT_TASKS_QUEUE: papertrend-app-tasks-production/);
  assert.match(pilot, /_REPOSITORY_CHAT_TASKS_QUEUE: papertrend-app-tasks-staging/);
  assert.match(production, /_DEEP_RESEARCH_TASKS_QUEUE: papertrend-research-production/);
  for (const yaml of [production, pilot]) assert.doesNotMatch(yaml, /_REPOSITORY_CHAT_TASKS_QUEUE: papertrend-ingestion/);
});

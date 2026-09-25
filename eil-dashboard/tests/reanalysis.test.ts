import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatReanalysisEstimate, validatePaperCorrection } from "../src/lib/reanalysis";

test("a correction needs a sensible title or a four-digit year", () => {
  assert.deepEqual(validatePaperCorrection({ title: "  Teacher   Agency  " }), { ok: true, title: "Teacher Agency" });
  assert.deepEqual(validatePaperCorrection({ year: "2021" }), { ok: true, year: "2021" });
  assert.deepEqual(validatePaperCorrection({ year: "Unknown" }), { ok: true, year: "Unknown" });
  assert.equal(validatePaperCorrection({}).ok, false);
  assert.equal(validatePaperCorrection({ year: "21" }).ok, false);
  assert.equal(validatePaperCorrection({ year: "2563" }).ok, false);
  assert.equal(validatePaperCorrection({ title: "ab" }).ok, false);
});

test("the estimate names the paper count and the cost", () => {
  assert.equal(formatReanalysisEstimate(1), "1 paper, about $0.02 of model use");
  assert.equal(formatReanalysisEstimate(39), "39 papers, about $0.78 of model use");
});

test("re-analysis is scoped to the verified owner's finished papers", async () => {
  const route = await readFile(new URL("../src/app/api/workspace/library/reanalyze/route.ts", import.meta.url), "utf8");
  const repository = await readFile(new URL("../src/lib/cloudsql/analysis-job-repository.ts", import.meta.url), "utf8");

  assert.match(route, /getAuthenticatedUserFromRequest\(request\)/);
  assert.match(route, /queueReanalysis\(\s*user\.id,/);
  assert.doesNotMatch(route, /ownerUserId:\s*body/);
  assert.match(repository, /ir\.owner_user_id = \$1 AND ir\.trashed_at IS NULL/);
  assert.match(repository, /rf\.owner_user_id = \$1 AND rf\.project_id/);
  // A failed paper can be tried again when picked on its own; a whole
  // repository is re-analysed from its finished papers only.
  assert.match(repository, /scope = `ir\.id = ANY\(\$\$\{values\.length\}::uuid\[\]\) AND ir\.status IN \('succeeded', 'failed'\)`/);
  assert.match(repository, /scope = `ir\.status = 'succeeded' AND ir\.folder_id IN/);
});

test("a failed re-analysis keeps the paper's earlier results", async () => {
  const worker = await readFile(new URL("../worker/process_ingestion_queue.py", import.meta.url), "utf8");
  const failure = worker.slice(worker.indexOf("kept = earlier_results_kept(claimed)"));
  assert.match(failure, /"status": "succeeded",[\s\S]{0,200}"error_message": None/);
  assert.ok(failure.indexOf('"status": "succeeded"') < failure.indexOf('"status": "failed"'));
  const library = await readFile(new URL("../src/components/admin/AdminImportClient.tsx", import.meta.url), "utf8");
  assert.match(library, /Try again/);
  assert.match(library, /reanalysis_failed_at/);
});

test("a correction is saved on the run so re-analysis keeps it", async () => {
  const repository = await readFile(new URL("../src/lib/cloudsql/analysis-job-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /jsonb_build_object\('user_overrides', \$3::jsonb\)/);
  assert.match(repository, /UPDATE public\.papers SET[\s\S]*WHERE id = \$1 AND owner_user_id = \$2/);
});

test("re-analysis applies the repository's current profile, taken on the server", async () => {
  // testtest's papers predate profiles and carried none, so re-analysing them
  // in an EIL repository left 37 of 39 "Other".
  const route = await readFile(new URL("../src/app/api/workspace/library/reanalyze/route.ts", import.meta.url), "utf8");
  const repository = await readFile(new URL("../src/lib/cloudsql/analysis-job-repository.ts", import.meta.url), "utf8");
  assert.match(route, /workspace\.getProject\(user\.id, id\)/);
  assert.match(route, /toIngestionAnalysisProfile\(/);
  assert.doesNotMatch(route, /body\.analysisProfile|body\.analysis_profile/);
  assert.match(repository, /jsonb_build_object\('analysis_profile', \$\$\{values\.length \+ 2\}::jsonb\)/);
  assert.match(repository, /async projectsOfRuns\(ownerUserId: string, runIds: string\[\]\)/);
});

test("re-analysis also gives old runs their repository id, so category rows are counted", async () => {
  // Older runs had no project_id in their payload, so their category rows were
  // saved with no repository: coverage read 0 classified of 38.
  const repository = await readFile(new URL("../src/lib/cloudsql/analysis-job-repository.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../src/app/api/workspace/library/reanalyze/route.ts", import.meta.url), "utf8");
  assert.match(repository, /jsonb_build_object\('project_id', \$\$\{values\.length \+ 3\}::text\)/);
  assert.match(route, /projectId: groupProjectId \|\| null/);
});

test("the reclassification job can be created on Cloud SQL", async () => {
  // "for SELECT DISTINCT, ORDER BY expressions must appear in select list":
  // the job's paper list selected p.id::text and sorted by p.id.
  const source = await readFile(new URL("../src/lib/project-reclassification-repository.ts", import.meta.url), "utf8");
  for (const match of source.matchAll(/SELECT DISTINCT([\s\S]*?)(?:`|\)\s*,)/g)) {
    const statement = match[1];
    const order = statement.match(/ORDER BY\s+([^\n`]+)/);
    if (!order) continue;
    for (const key of order[1].split(",").map((part) => part.trim().split(/\s+/)[0])) {
      // A sort key must be a selected alias (or a column position).
      assert.ok(
        statement.includes(`AS ${key}`) || /^\d+$/.test(key),
        `ORDER BY ${key} is not in the DISTINCT select list`
      );
    }
  }
});

test("publishing a reclassification replaces its papers' rows, including rows saved with no repository", async () => {
  // Pilot: "duplicate key value violates unique constraint
  // paper_category_definitions_owner_user_id_paper_id_category__key" - the key
  // has no repository in it, and rows from runs without a project_id survived.
  const source = await readFile(new URL("../src/lib/project-reclassification-repository.ts", import.meta.url), "utf8");
  const publish = source.slice(source.indexOf("export async function publishReclassificationJob"));
  for (const table of ["paper_category_assignments", "paper_category_definitions"]) {
    assert.ok(
      publish.includes(`DELETE FROM public.${table} WHERE owner_user_id=$1 AND (project_id=$2 OR paper_id=ANY($3::bigint[]))`),
      `${table} is cleared for the job's own papers`
    );
  }
});

/*
 * Repository analysis profiles, run rather than read (docs/32, long-term
 * health): uploads, reclassification, invalidation, coverage and the pilot
 * flag against PGlite under the app's role (tests/support/route-harness.ts),
 * and the repository index drawn as the browser gets it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { paperIdFromRunId } from "../src/lib/paper-id";
import {
  createEilAnalysisProfile,
  createGeneralAnalysisProfile,
  toIngestionAnalysisProfile,
} from "../src/lib/project-analysis-profile";
import type { ProjectAnalysisProfile } from "../src/types/workspace";
import { params, routeHarness, stubModule } from "./support/route-harness";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// Storage signing and the browser-side providers are swapped for this process.
stubModule("/src/lib/gcs-signed-urls.ts", new URL("./support/stub-profiledash-gcs.ts", import.meta.url).href);
stubModule("/src/components/auth/AuthProvider.tsx", new URL("./support/stub-profiledash-auth.ts", import.meta.url).href);
stubModule("/src/components/workspace/WorkspaceProvider.tsx", new URL("./support/stub-profiledash-workspace.ts", import.meta.url).href);
(globalThis as { React?: typeof React }).React = React;

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000c9";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a9";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const OTHER_FOLDER = "00000000-0000-4000-8000-0000000000f9";
const EIL = createEilAnalysisProfile();
const GENERAL = createGeneralAnalysisProfile();
const runOf = (n: number) => `${n.toString(16).padStart(8, "0")}-e5f6-4a7b-8c9d-0e1f2a3b4c5d`;
const hash64 = (character: string) => character.repeat(64);

async function repositories(env: Record<string, string | undefined> = {}, profile: ProjectAnalysisProfile = EIL) {
  const harness = await routeHarness({ PROJECT_ANALYSIS_PROFILES_ENABLED: "true", ...env });
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.query(`INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ($1, $2, 'Org'), ($3, $4, 'Org')`, [ORG, OWNER, OTHER_ORG, OTHER]);
  for (const [id, organization, who, name] of [[PROJECT, ORG, OWNER, "Mine"], [OTHER_PROJECT, OTHER_ORG, OTHER, "Theirs"]]) {
    await harness.db.query(
      `INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now())`,
      [id, organization, who, name, JSON.stringify(profile), profile.version, profile.profileHash]
    );
  }
  await harness.db.query(
    `INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ($1, $2, 'A', $3), ($4, $5, 'Z', $6)`,
    [FOLDER, OWNER, PROJECT, OTHER_FOLDER, OTHER, OTHER_PROJECT]
  );
  return { ...harness, owner, other };
}

/** A paper as analysis leaves it: its run, its row and its content. */
async function paper(
  db: Awaited<ReturnType<typeof repositories>>["db"],
  n: number,
  { who = OWNER, folder = FOLDER, status = "succeeded", trashed = false }: { who?: string; folder?: string; status?: string; trashed?: boolean } = {}
) {
  const run = runOf(n);
  const id = paperIdFromRunId(run);
  await db.query(
    `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, trashed_at) VALUES ($1, $2, $3, 'upload', $4, CASE WHEN $5 THEN now() END)`,
    [run, who, folder, status, trashed]
  );
  await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [id, who, folder, `Paper ${n}`]);
  await db.query(
    `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract_claims) VALUES ($1, $2, $3, $4, 'Claims.')`,
    [id, who, folder, run]
  );
  return id;
}

async function categoryRow(db: Awaited<ReturnType<typeof repositories>>["db"], paperId: string, key: string, profileHash: string, project = PROJECT) {
  await db.query(
    `INSERT INTO paper_category_assignments (paper_id, owner_user_id, folder_id, project_id, category_key, category_label, assignment_type, profile_hash)
     VALUES ($1, $2, $3, $4, $5, $5, 'single', $6)`,
    [paperId, OWNER, FOLDER, project, key, profileHash]
  );
}

test("an upload takes its analysis profile from the repository, never from the browser", async () => {
  const { db, request, owner } = await repositories({ STORAGE_PROVIDER: "gcs", GCS_UPLOAD_BUCKET: "route-test-uploads" });
  const { POST } = await import("../src/app/api/admin/import/prepare/route");
  const prepare = (projectId: string) =>
    POST(
      request("/api/admin/import/prepare", {
        headers: owner,
        body: {
          project_id: projectId,
          folder: "Batch",
          analysis_profile: { mode: "general", classificationEnabled: false, categories: [] },
          files: [{ fileIndex: 0, name: "paper.pdf", size: 2048, type: "application/pdf" }],
        },
      })
    );
  const response = await prepare(PROJECT);
  assert.equal(response.status, 201);
  const { uploads } = await response.json();
  const stored = await db.query<{ profile: unknown }>(`SELECT input_payload->'analysis_profile' AS profile FROM ingestion_runs WHERE id = $1`, [uploads[0].runId]);
  assert.deepEqual(stored.rows[0].profile, JSON.parse(JSON.stringify(toIngestionAnalysisProfile(EIL))), "the repository's EIL profile, not the General one sent");

  const theirs = await prepare(OTHER_PROJECT);
  assert.equal(theirs.status, 404, "another person's repository is not found");
  const runs = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ingestion_runs`);
  assert.equal(runs.rows[0].count, 1, "and nothing is prepared for it");
});

test("the profile migration keeps old category rows as a legacy revision, and its job tables are each owner's own", async () => {
  // The migration file is applied as written, over a category row saved before profiles.
  const { db } = await repositories();
  const id = await paper(db, 1);
  await db.query(
    `INSERT INTO paper_category_assignments (paper_id, owner_user_id, project_id, category_key, category_label, assignment_type) VALUES ($1, $2, $3, 'el', 'EL', 'single')`,
    [id, OWNER, PROJECT]
  );
  await db.exec(read("../cloudsql/20260910_project_analysis_profiles.sql"));
  const legacy = await db.query(`SELECT profile_hash, profile_version, classifier_model FROM paper_category_assignments`);
  assert.deepEqual(legacy.rows, [{ profile_hash: "legacy", profile_version: 1, classifier_model: "legacy" }]);

  const forced = await db.query<{ relname: string; forced: boolean }>(
    `SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE relname IN ('project_reclassification_jobs', 'project_reclassification_items') ORDER BY relname`
  );
  assert.deepEqual(forced.rows, [{ relname: "project_reclassification_items", forced: true }, { relname: "project_reclassification_jobs", forced: true }]);

  const { createReclassificationJob } = await import("../src/lib/project-reclassification-repository");
  const { withCloudSqlOwnerTransaction } = await import("../src/lib/cloudsql/client");
  const job = await createReclassificationJob(OWNER, PROJECT, EIL);
  const seen = await withCloudSqlOwnerTransaction(OTHER, async (client) => ({
    jobs: (await client.query("SELECT id FROM project_reclassification_jobs")).rows.length,
    items: (await client.query("SELECT id FROM project_reclassification_items")).rows.length,
  }));
  assert.deepEqual(seen, { jobs: 0, items: 0 }, "another person sees no job and no item");
  await assert.rejects(
    withCloudSqlOwnerTransaction(OTHER, (client) =>
      client.query(
        `INSERT INTO project_reclassification_items (job_id, owner_user_id, project_id, paper_id) VALUES ($1, $2, $3, $4)`,
        [job.id, OWNER, PROJECT, id]
      )
    ),
    /row-level security/,
    "nor stage an item in it"
  );
});

test("a reclassification publishes only when every paper succeeded, keeping the live categories until then", async () => {
  const { db } = await repositories();
  const first = await paper(db, 1);
  const second = await paper(db, 2);
  await categoryRow(db, first, "el", "legacy");
  await categoryRow(db, second, "el", "legacy");
  await db.query(
    `INSERT INTO workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash) VALUES ($1, 'project', $2, 'v1')`,
    [OWNER, PROJECT]
  );
  for (const [status, character] of [["succeeded", "a"], ["failed", "b"]]) {
    await db.query(
      `INSERT INTO repository_semantic_maps (owner_user_id, project_id, status, source_hash, representation_version) VALUES ($1, $2, $3, $4, 'v1')`,
      [OWNER, PROJECT, status, hash64(character)]
    );
  }
  const repository = await import("../src/lib/project-reclassification-repository");
  const job = await repository.createReclassificationJob(OWNER, PROJECT, EIL);
  assert.equal(job.total_items, 2);
  await repository.claimReclassificationJob(OWNER, job.id);
  const items = await repository.loadReclassificationPapers(OWNER, job.id);
  assert.deepEqual(items.map((item) => item.paperId), [first, second]);
  await repository.saveReclassificationItem(OWNER, job.id, items[0].itemId, { primaryCategoryKey: "eli", additionalCategoryKeys: ["lae"], rationale: "Teaching." }, "test-model");
  await repository.saveReclassificationItem(OWNER, job.id, items[1].itemId, null, "test-model", new Error("model timed out"));

  const live = () => db.query<{ paper_id: string; category_key: string; assignment_type: string; profile_hash: string }>(
    `SELECT paper_id::text, category_key, assignment_type, profile_hash FROM paper_category_assignments ORDER BY paper_id, assignment_type, position`
  );
  const maps = () => db.query<{ status: string; source_hash: string }>(`SELECT status, source_hash FROM repository_semantic_maps ORDER BY status`);
  const before = (await live()).rows;
  await assert.rejects(repository.publishReclassificationJob(OWNER, job.id), /Some papers were not classified; the previous revision was preserved/);
  assert.deepEqual((await live()).rows, before, "a failed paper keeps every live row");
  assert.equal((await repository.getReclassificationJob(OWNER, PROJECT, job.id))?.status, "processing");
  assert.deepEqual((await maps()).rows, [{ status: "failed", source_hash: hash64("b") }, { status: "succeeded", source_hash: hash64("a") }]);

  const retried = await repository.loadReclassificationPapers(OWNER, job.id);
  assert.deepEqual(retried.map((item) => item.paperId), [second], "only the failed paper is tried again");
  await repository.saveReclassificationItem(OWNER, job.id, retried[0].itemId, { primaryCategoryKey: "el", rationale: "Phonology." }, "test-model");
  assert.deepEqual(await repository.publishReclassificationJob(OWNER, job.id), { projectId: PROJECT, published: 2 });
  assert.deepEqual((await live()).rows, [
    { paper_id: first, category_key: "eli", assignment_type: "multi", profile_hash: EIL.profileHash },
    { paper_id: first, category_key: "lae", assignment_type: "multi", profile_hash: EIL.profileHash },
    { paper_id: first, category_key: "eli", assignment_type: "single", profile_hash: EIL.profileHash },
    { paper_id: second, category_key: "el", assignment_type: "multi", profile_hash: EIL.profileHash },
    { paper_id: second, category_key: "el", assignment_type: "single", profile_hash: EIL.profileHash },
  ]);
  const published = await repository.getReclassificationJob(OWNER, PROJECT, job.id);
  assert.equal(published?.status, "succeeded");
  assert.equal(published?.progress_stage, "published");
  const cache = await db.query(`SELECT 1 FROM workspace_analytics_cache WHERE scope_type = 'project'`);
  assert.equal(cache.rows.length, 0, "the repository's analytics are rebuilt");
  const [failedMap, succeededMap] = (await maps()).rows;
  assert.equal(failedMap.source_hash, hash64("b"), "a failed map is left alone");
  assert.notEqual(succeededMap.source_hash, hash64("a"), "a built map is marked stale");
  assert.match(succeededMap.source_hash, /^[0-9a-f]{64}$/, "with a hash of the stored length");
});

test("changing a repository's profile clears its analytics and marks its semantic maps stale; renaming it does not", async () => {
  const { db, request, owner } = await repositories();
  const { PATCH } = await import("../src/app/api/workspace/projects/route");
  await db.query(
    `INSERT INTO workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash) VALUES ($1, 'project', $2, 'v1'), ($1, 'project', $3, 'v1')`,
    [OWNER, PROJECT, "another-repository"]
  );
  for (const [status, character, project, who] of [
    ["queued", "a", PROJECT, OWNER],
    ["processing", "b", PROJECT, OWNER],
    ["succeeded", "c", PROJECT, OWNER],
    ["failed", "d", PROJECT, OWNER],
    ["canceled", "e", PROJECT, OWNER],
    ["succeeded", "f", OTHER_PROJECT, OTHER],
  ]) {
    await db.query(
      `INSERT INTO repository_semantic_maps (owner_user_id, project_id, status, source_hash, representation_version) VALUES ($1, $2, $3, $4, 'v1')`,
      [who, project, status, hash64(character)]
    );
  }
  const maps = async () =>
    (await db.query<{ status: string; project_id: string; source_hash: string }>(`SELECT status, project_id, source_hash FROM repository_semantic_maps ORDER BY source_hash`)).rows;
  const caches = async () => (await db.query<{ scope_key: string }>(`SELECT scope_key FROM workspace_analytics_cache ORDER BY scope_key`)).rows.map((row) => row.scope_key);
  const patch = (body: Record<string, unknown>) => PATCH(request("/api/workspace/projects", { method: "PATCH", headers: owner, body: { projectId: PROJECT, ...body } }));

  const before = await maps();
  assert.equal((await patch({ name: "Renamed" })).status, 200);
  assert.deepEqual(await maps(), before, "a rename leaves the maps");
  assert.deepEqual(await caches(), ["00000000-0000-4000-8000-0000000000a1", "another-repository"]);

  const changed = await patch({ name: "Renamed", analysisProfile: { mode: "general" } });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).project.analysis_profile.mode, "general");
  assert.deepEqual(await caches(), ["another-repository"], "only this repository's analytics are cleared");
  const after = await maps();
  for (const [index, map] of before.entries()) {
    const now = after.find((row) => row.status === map.status && row.project_id === map.project_id)!;
    const stale = map.project_id === PROJECT && ["queued", "processing", "succeeded"].includes(map.status);
    if (stale) {
      assert.notEqual(now.source_hash, map.source_hash, `${map.status} map is marked stale`);
      assert.match(now.source_hash, /^[0-9a-f]{64}$/);
    } else {
      assert.equal(now.source_hash, map.source_hash, `map ${index} (${map.status}) is left alone`);
    }
  }
});

test("General Research counts analysed papers as current without category rows; a classifying profile does not", async () => {
  const { db } = await repositories({}, GENERAL);
  const plain = await paper(db, 1);
  const oldRevision = await paper(db, 2);
  await categoryRow(db, oldRevision, "el", "legacy");
  await paper(db, 3, { trashed: true });
  await paper(db, 4, { status: "failed" });
  await paper(db, 5, { who: OTHER, folder: OTHER_FOLDER });
  const { getClassificationCoverage } = await import("../src/lib/project-reclassification-repository");
  assert.deepEqual(await getClassificationCoverage(OWNER, PROJECT), { classified: 1, previousProfile: 1, unclassified: 0, failed: 1 });

  await db.query(
    `UPDATE workspace_projects SET analysis_profile = $2::jsonb, analysis_profile_hash = $3 WHERE id = $1`,
    [PROJECT, JSON.stringify(EIL), EIL.profileHash]
  );
  const current = await paper(db, 6);
  await categoryRow(db, current, "eli", EIL.profileHash);
  assert.deepEqual(
    await getClassificationCoverage(OWNER, PROJECT),
    { classified: 1, previousProfile: 1, unclassified: 1, failed: 1 },
    `with categories on, ${plain} has none yet`
  );
});

test("profile controls and reclassification job routes stay off until the pilot flag is on", async () => {
  const { db, request, owner, other } = await repositories({ PROJECT_ANALYSIS_PROFILES_ENABLED: undefined });
  const projects = await import("../src/app/api/workspace/projects/route");
  const jobs = await import("../src/app/api/workspace/projects/[projectId]/reclassify/[jobId]/route");
  const { createReclassificationJob } = await import("../src/lib/project-reclassification-repository");
  await paper(db, 1);
  const job = await createReclassificationJob(OWNER, PROJECT, EIL);
  const create = async (name: string) => {
    const response = await projects.POST(request("/api/workspace/projects", { headers: owner, body: { organizationId: ORG, name, analysisProfile: { mode: "eil" } } }));
    assert.equal(response.status, 201);
    return (await response.json()).project.analysis_profile.mode;
  };
  const getJob = (headers: Record<string, string>) =>
    jobs.GET(request(`/api/workspace/projects/${PROJECT}/reclassify/${job.id}`, { headers }), params({ projectId: PROJECT, jobId: job.id }));

  assert.equal(await create("Off"), "general", "with the flag off, a requested profile is ignored");
  const hidden = await getJob(owner);
  assert.equal(hidden.status, 404);
  assert.deepEqual(await hidden.json(), { error: "Repository profiles are not enabled." });
  const cancel = await jobs.POST(
    request(`/api/workspace/projects/${PROJECT}/reclassify/${job.id}`, { headers: owner, body: { action: "cancel" } }),
    params({ projectId: PROJECT, jobId: job.id })
  );
  assert.equal(cancel.status, 404);
  const still = await db.query<{ status: string }>(`SELECT status FROM project_reclassification_jobs WHERE id = $1`, [job.id]);
  assert.equal(still.rows[0].status, "queued", "and nothing is done");

  process.env.PROJECT_ANALYSIS_PROFILES_ENABLED = "true";
  try {
    assert.equal(await create("On"), "eil");
    const shown = await getJob(owner);
    assert.equal(shown.status, 200);
    assert.equal((await shown.json()).job.id, job.id);
    assert.equal((await getJob(other)).status, 404, "another person's job is not found");
  } finally {
    delete process.env.PROJECT_ANALYSIS_PROFILES_ENABLED;
  }
  // The pilot deployment turns the browser's controls on (deploy config, read as data).
  assert.match(read("../../cloudbuild.web.cloudsql.pilot.yaml"), /NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED=true/);
});

test("a stored profile in an old shape is read as a profile, not an error that empties the account", async () => {
  const { db, request, owner } = await repositories();
  await db.query(`UPDATE workspace_projects SET analysis_profile = $2::jsonb WHERE id = $1`, [
    PROJECT,
    JSON.stringify({ mode: "custom", displayName: "Old taxonomy", categories: [{ label: "Phonology" }, { label: "Pragmatics" }] }),
  ]);
  const { GET } = await import("../src/app/api/workspace/projects/route");
  const response = await GET(request("/api/workspace/projects", { headers: owner }));
  assert.equal(response.status, 200);
  const [project] = (await response.json()).projects;
  assert.equal(project.name, "Mine");
  assert.equal(project.analysis_profile.mode, "custom");
  assert.deepEqual(project.analysis_profile.categories.map((category: { label: string }) => category.label), ["Phonology", "Pragmatics"]);
});

test("the repository index says a failed load is not an empty account, and hides profiles without the flag", async () => {
  delete process.env.NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED;
  const { ThemeProvider } = await import("../src/components/theme/ThemeProvider");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { default: ProjectIndexClient } = await import("../src/components/workspace/workspaces/ProjectIndexClient");
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  globalThis.__profiledashAuth = { hydrated: true, user: { id: OWNER, email: "person@papertrend.test" } };
  const draw = (workspace: Record<string, unknown>) => {
    globalThis.__profiledashWorkspace = workspace;
    return renderToStaticMarkup(
      createElement(AppRouterContext.Provider, { value: router as never }, createElement(ThemeProvider, null, createElement(ProjectIndexClient)))
    );
  };
  try {
    const failed = draw({ allProjects: [], workspaceLoadError: "The server could not be reached." });
    assert.match(failed, /Repositories could not be loaded/);
    assert.match(failed, /Your data has not been removed\. The server could not be reached\./);
    assert.doesNotMatch(failed, /Start your first repository/, "no invitation to start over");

    assert.match(draw({ allProjects: [] }), /Start your first repository/, "an account that is empty says so");
    const listed = draw({ allProjects: [{ id: PROJECT, name: "Mine", analysis_profile: EIL, updated_at: null }] });
    assert.match(listed, /Mine/);
    assert.doesNotMatch(listed, /EIL Tracks/, "the profile is not shown without the flag");
  } finally {
    globalThis.__profiledashAuth = undefined;
    globalThis.__profiledashWorkspace = undefined;
  }
  // Setting workspaceLoadError when the list fails happens inside the provider's
  // effects, which need a browser; the wording is checked.
  assert.match(read("../src/components/workspace/WorkspaceProvider.tsx"), /setWorkspaceLoadError\(\s*error instanceof Error \? error\.message : "Failed to load repositories\."/);
});

test("versioned taxonomy evaluation covers EIL, custom, Thai, ambiguity, and prompt injection", () => {
  const fixture = JSON.parse(read("../evals/project-taxonomy-v2.json")) as {
    version?: string;
    profiles?: Record<string, unknown>;
    cases?: Array<{ profile?: string; expectedPrimary?: string; abstractClaims?: string }>;
  };
  assert.match(String(fixture.version), /^project-taxonomy-v2/);
  assert.ok((fixture.cases?.length ?? 0) >= 16);
  assert.ok(fixture.cases?.some((item) => item.profile === "eil" && item.expectedPrimary === "other"));
  assert.ok(fixture.cases?.some((item) => item.profile === "thai_policy"));
  assert.ok(fixture.cases?.some((item) => /IGNORE THE TAXONOMY/i.test(item.abstractClaims ?? "")));
  assert.ok(Object.keys(fixture.profiles ?? {}).length >= 2);
});

test("the ingestion classifier treats paper text as untrusted input", () => {
  // The classifier is the Python pipeline's (nodes/), which no TypeScript runs;
  // its prompt and model setting are checked as written.
  const prompt = read("../../prompts/track_classifier.txt");
  const node = read("../../nodes/track_classifier.py");
  assert.match(prompt, /untrusted research content/i);
  assert.match(prompt, /never as commands/i);
  assert.match(node, /track_classification_llm\.model_name/);
});

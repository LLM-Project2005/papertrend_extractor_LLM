import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Cloud SQL upload derives the profile from the authenticated repository", () => {
  const source = read("../src/app/api/admin/import/prepare/route.ts");
  assert.match(source, /getWorkspaceRepository\(\)\.getProject\(user\.id, projectId\)/);
  assert.match(source, /sanitizeProjectAnalysisProfile\(project\.analysis_profile\)/);
  assert.match(source, /toIngestionAnalysisProfile\(authoritativeProfile\)/);
});

test("reclassification schema stages results behind forced owner RLS", () => {
  const migration = read("../cloudsql/20260910_project_analysis_profiles.sql");
  assert.match(migration, /project_reclassification_jobs/);
  assert.match(migration, /project_reclassification_items/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/g);
  assert.match(migration, /owner_user_id = public\.papertrend_current_user_id\(\)/);
  assert.match(migration, /COALESCE\(profile_hash, 'legacy'\)/);
});

test("transactional publication preserves live rows until all staged items succeeded", () => {
  const source = read("../src/lib/project-reclassification-repository.ts");
  const invalidation = read("../src/lib/semantic-map-invalidation.ts");
  const validation = source.indexOf("Some papers were not classified");
  const deletion = source.indexOf("DELETE FROM public.paper_category_assignments");
  assert.ok(validation >= 0 && deletion > validation);
  assert.match(source, /status='succeeded',progress_stage='published'/);
  assert.match(source, /markProjectSemanticMapsStale/);
  assert.match(invalidation, /UPDATE public\.repository_semantic_maps/);
});

test("profile changes invalidate project analytics and semantic maps", () => {
  const source = read("../src/lib/cloudsql/workspace-repository.ts");
  const invalidation = read("../src/lib/semantic-map-invalidation.ts");
  assert.match(source, /patch\.analysisProfile !== undefined/);
  assert.match(source, /DELETE FROM public\.workspace_analytics_cache/);
  assert.match(source, /markProjectSemanticMapsStale/);
  assert.equal((invalidation.match(/md5\(source_hash/g) ?? []).length, 2);
  assert.doesNotMatch(invalidation, /invalidated:'\|\|source_hash/);
  assert.match(invalidation, /status IN \('queued', 'processing', 'succeeded'\)/);
});

test("General Research coverage treats successful papers as current without category rows", () => {
  const source = read("../src/lib/project-reclassification-repository.ts");
  assert.match(source, /classification_enabled/);
  assert.match(source, /\$4::boolean AND c\.paper_id IS NULL/);
  assert.match(source, /\$4::boolean AND c\.paper_id IS NOT NULL/);
  assert.match(source, /NOT \$4::boolean AND c\.paper_id IS NULL/);
});

test("project analysis controls and reclassification routes remain behind the pilot flag", () => {
  const pilot = read("../../cloudbuild.web.cloudsql.pilot.yaml");
  const projectRoute = read("../src/app/api/workspace/projects/route.ts");
  const jobRoute = read("../src/app/api/workspace/projects/[projectId]/reclassify/[jobId]/route.ts");
  const projectIndex = read("../src/components/workspace/workspaces/ProjectIndexClient.tsx");
  assert.match(pilot, /NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED=true/);
  assert.match(projectRoute, /projectAnalysisProfilesEnabled\(\)/);
  assert.match(jobRoute, /projectAnalysisProfilesEnabled\(\)/);
  assert.match(projectIndex, /NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED/);
});

test("forced-RLS backfill requires an explicit owner context for the app role", () => {
  const source = read("../scripts/migrate-project-analysis-profiles.ts");
  assert.match(source, /databaseUser === "papertrend_app" && ownerUserIds\.length !== 1/);
  assert.match(source, /set_config\('app\.current_user_id'/);
});

test("legacy profile errors cannot masquerade as an empty repository account", () => {
  const repository = read("../src/lib/cloudsql/workspace-repository.ts");
  const provider = read("../src/components/workspace/WorkspaceProvider.tsx");
  const index = read("../src/components/workspace/workspaces/ProjectIndexClient.tsx");
  assert.match(repository, /normalizeStoredProjectAnalysisProfile/);
  assert.match(provider, /workspaceLoadError/);
  assert.match(index, /Your data has not been removed/);
  assert.match(index, /!workspaceLoadError && visibleProjects\.length === 0/);
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
  const prompt = read("../../prompts/track_classifier.txt");
  const node = read("../../nodes/track_classifier.py");
  assert.match(prompt, /untrusted research content/i);
  assert.match(prompt, /never as commands/i);
  assert.match(node, /track_classification_llm\.model_name/);
});

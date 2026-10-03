/*
 * A group of people is never a dashboard topic, whichever way topics are read
 * (docs/32, long-term health): the dashboard's own load against PGlite under
 * the app's role (tests/support/route-harness.ts), and the Supabase loads -
 * the dashboard's and the corpus topic cache's - over an in-memory PostgREST
 * (stub-smallfix2-supabase-admin.ts). The loaders run as written; no model is
 * configured, so nothing is sent.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { paperIdFromRunId } from "../src/lib/paper-id";
import type { DashboardData } from "../src/types/database";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/supabase-admin.ts", new URL("./support/stub-smallfix2-supabase-admin.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const RUN = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
const PAPER = paperIdFromRunId(RUN);

// The rows behind testtest's 29-paper "EFL Learner Characteristics and Demographics" theme.
const KEYWORDS = [
  { topic: "Thai EFL Undergraduate Students", keyword: "Thai EFL undergraduate students" },
  { topic: "Thai EFL Undergraduate Students", keyword: "L2 proficiency" },
  { topic: "Speaking Anxiety", keyword: "speaking anxiety" },
  { topic: "Speaking Anxiety", keyword: "Thai EFL learners" },
];
const EXPECTED = [
  ["L2 proficiency", "L2 proficiency"],
  ["Speaking Anxiety", "speaking anxiety"],
];

const topicsOf = (data: Pick<DashboardData, "trends">) => data.trends.map((row) => [row.topic, row.keyword]).sort();

test("the dashboard's topics leave out who was studied and keep what was studied about them", async () => {
  delete process.env.OPENAI_API_KEY;
  const harness = await routeHarness();
  await harness.signIn(OWNER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'A', '${PROJECT}');
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status) VALUES ('${RUN}', '${OWNER}', '${FOLDER}', 'upload', 'succeeded');
  `);
  await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', 'Speaking anxiety in Thai classrooms')`, [PAPER, OWNER, FOLDER]);
  await harness.db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id) VALUES ($1, $2, $3, $4)`, [PAPER, OWNER, FOLDER, RUN]);
  for (const row of KEYWORDS) {
    await harness.db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, $4, $5)`, [PAPER, OWNER, FOLDER, row.topic, row.keyword]);
  }
  const dashboard = await import("../src/lib/dashboard-data-server");
  assert.deepEqual(topicsOf(await dashboard.loadDashboardDataServer(OWNER, [], PROJECT, "live", { fresh: true })), EXPECTED, "a repository's dashboard");
  assert.deepEqual(topicsOf(await dashboard.loadScopedDashboardData(OWNER, null)), EXPECTED, "every paper of the account");
});

test("the Supabase dashboard and its corpus topic cache leave them out too, concepts included", async () => {
  const saved = process.env.DATABASE_PROVIDER;
  process.env.DATABASE_PROVIDER = "supabase";
  delete process.env.OPENAI_API_KEY;
  const paper = { paper_id: PAPER, owner_user_id: OWNER, folder_id: FOLDER };
  globalThis.__smallfix2Tables = {
    research_folders: [{ id: FOLDER, owner_user_id: OWNER, project_id: PROJECT }],
    ingestion_runs: [{ id: RUN, owner_user_id: OWNER, folder_id: FOLDER }],
    papers_full: [{ ...paper, year: "2021", title: "Speaking anxiety in Thai classrooms", ingestion_run_id: RUN }],
    paper_keywords: KEYWORDS.map((row) => ({ ...paper, ...row, keyword_frequency: 1, evidence: "" })),
    paper_keyword_concepts: [
      { ...paper, concept_label: "Thai EFL undergraduate students", matched_terms: ["Thai EFL undergraduate students"], related_keywords: [], total_frequency: 3 },
      { ...paper, concept_label: "speaking anxiety", matched_terms: ["speaking anxiety"], related_keywords: [], total_frequency: 2 },
    ],
    trends_flat: [],
    tracks_single_flat: [],
    tracks_multi_flat: [],
    paper_tracks_single: [],
    paper_tracks_multi: [],
    user_profiles: [{ id: OWNER, workspace_profile: {} }],
  };
  try {
    const dashboard = await import("../src/lib/dashboard-data-server");
    assert.deepEqual(topicsOf(await dashboard.loadScopedDashboardData(OWNER, null)), EXPECTED);

    const { loadOrBuildProjectCorpusTopicCache } = await import("../src/lib/corpus-topic-cache");
    const { cache } = await loadOrBuildProjectCorpusTopicCache(OWNER, PROJECT);
    const named = JSON.stringify([cache.families.map((family) => [family.canonicalTopic, family.aliases, family.matchedTerms]), cache.trends.map((row) => [row.topic, row.keyword])]);
    assert.ok(cache.trends.length > 0 && cache.families.length > 0, named);
    for (const group of ["Thai EFL undergraduate students", "Thai EFL learners", "Thai EFL Undergraduate Students"]) {
      assert.ok(!named.includes(group), `${group} is a topic: ${named}`);
    }
    assert.ok(named.includes("speaking anxiety") && named.includes("L2 proficiency"), named);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_PROVIDER;
    else process.env.DATABASE_PROVIDER = saved;
  }
});

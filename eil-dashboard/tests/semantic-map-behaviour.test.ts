/*
 * The semantic map's routes called as a signed-in person, against PGlite under
 * the app's role (tests/support/route-harness.ts): who owns a map, what its
 * coverage counts, and what reaches the browser. No model, no Cloud Tasks and
 * no network: the queue is unconfigured and fetch refuses every call.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { params, routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a9";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const run = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ABSTRACT = "Peer feedback rounds raised draft quality in every cohort studied.";
const EMBEDDING_VALUE = "0.0421337";

globalThis.fetch = (async () => {
  throw new Error("No network in the semantic map tests.");
}) as typeof fetch;

type Seed = { run: number; owner: string; status: string; paper?: number; content?: boolean; trashed?: boolean; payload?: object; folder?: string | null };

// The owner's repository: two analyzed papers, one success with no saved
// analysis, one each queued, processing and failed, one in the trash, and a
// run of someone else's that names the owner's repository in its payload.
const SEEDS: Seed[] = [
  { run: 1, owner: OWNER, status: "succeeded", paper: 101, content: true },
  { run: 2, owner: OWNER, status: "succeeded", paper: 102, content: true },
  { run: 3, owner: OWNER, status: "succeeded", paper: 103 },
  { run: 4, owner: OWNER, status: "queued" },
  { run: 5, owner: OWNER, status: "processing" },
  { run: 6, owner: OWNER, status: "failed" },
  { run: 7, owner: OWNER, status: "succeeded", paper: 107, content: true, trashed: true },
  { run: 8, owner: OTHER, status: "succeeded", paper: 108, content: true, folder: null, payload: { project_id: PROJECT } },
];

async function repository() {
  const harness = await routeHarness({
    SEMANTIC_MAP_ENABLED: "true",
    SEMANTIC_MAP_INLINE_JOBS: undefined,
    GOOGLE_CLOUD_PROJECT_ID: undefined,
    GCLOUD_PROJECT: undefined,
  });
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{}'::jsonb, 2, 'test', now()),
      ('${OTHER_PROJECT}', '00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Theirs', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Writing', '${PROJECT}');
  `);
  for (const seed of SEEDS) {
    const folder = seed.folder === undefined ? FOLDER : seed.folder;
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload, trashed_at)
       VALUES ($1, $2, $3, 'upload', $4, 'paper.pdf', $5::jsonb, $6)`,
      [run(seed.run), seed.owner, folder, seed.status, JSON.stringify(seed.payload ?? {}), seed.trashed ? new Date().toISOString() : null]
    );
    if (seed.paper === undefined) continue;
    await harness.db.query(
      `INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`,
      [seed.paper, seed.owner, folder, `Paper ${seed.paper}`]
    );
    if (!seed.content) continue;
    await harness.db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, abstract, methods, results, conclusion, ingestion_run_id)
       VALUES ($1, $2, $3, $4, 'Survey of writing classes', 'Drafts improved', 'Feedback helps', $5)`,
      [seed.paper, seed.owner, folder, ABSTRACT, run(seed.run)]
    );
  }
  return { ...harness, owner, other };
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

test("a map and its coverage are read for the signed-in person's own repository only", async () => {
  const { request, owner, other } = await repository();
  const { GET } = await import("../src/app/api/workspace/semantic-map/route");

  const anonymous = await GET(request(`/api/workspace/semantic-map?projectId=${PROJECT}`));
  assert.equal(anonymous.status, 401);

  const mine = await GET(request(`/api/workspace/semantic-map?projectId=${PROJECT}`, { headers: owner }));
  assert.equal(mine.status, 200);
  const body = await mine.json();
  assert.equal(body.map, null);
  // Six of the owner's runs (not the trashed one, not the other person's);
  // three succeeded, two of them with analysis the map can use.
  assert.deepEqual(body.coverage, {
    repositoryFiles: 6,
    analyzedFiles: 3,
    eligiblePapers: 2,
    queuedFiles: 1,
    processingFiles: 1,
    failedFiles: 1,
    missingAnalysis: 1,
  });
  assert.equal(body.eligiblePapers, 2);

  // An owner named in the query string changes nothing: the token decides.
  const theirs = await GET(request(`/api/workspace/semantic-map?projectId=${PROJECT}&ownerUserId=${OWNER}`, { headers: other }));
  assert.equal(theirs.status, 404);
  assert.equal((await theirs.json()).error, "Repository not found.");
});

test("generating a map records the job for the signed-in person, whatever owner the body names", async () => {
  const { db, request, owner, other } = await repository();
  const { POST } = await import("../src/app/api/workspace/semantic-map/route");
  const job = await import("../src/app/api/workspace/semantic-map/jobs/[jobId]/route");

  const refused = await POST(request("/api/workspace/semantic-map", { headers: other, body: { projectId: PROJECT, ownerUserId: OWNER } }));
  assert.equal(refused.ok, false);
  assert.equal((await refused.json()).error, "Repository not found.");
  assert.equal((await db.query("SELECT 1 FROM repository_semantic_maps")).rows.length, 0, "nothing written for someone else's repository");

  // Cloud Tasks is not configured here, so the job is recorded and then failed, not left queued.
  const made = await POST(request("/api/workspace/semantic-map", { headers: owner, body: { projectId: PROJECT, ownerUserId: OTHER } }));
  assert.equal(made.status, 503);
  const { mapId } = await made.json();
  const rows = await db.query<{ id: string; owner_user_id: string; project_id: string; paper_count: number; status: string; error_message: string }>(
    `SELECT id, owner_user_id, project_id, paper_count, status, error_message FROM repository_semantic_maps`
  );
  assert.deepEqual(rows.rows, [{
    id: mapId,
    owner_user_id: OWNER,
    project_id: PROJECT,
    paper_count: 2,
    status: "failed",
    error_message: "Cloud Tasks could not enqueue semantic map generation.",
  }]);

  const seenByOther = await job.GET(request(`/api/workspace/semantic-map/jobs/${mapId}`, { headers: other }), params({ jobId: mapId }));
  assert.equal(seenByOther.status, 404);
  const seenByOwner = await job.GET(request(`/api/workspace/semantic-map/jobs/${mapId}`, { headers: owner }), params({ jobId: mapId }));
  assert.equal(seenByOwner.status, 200);
  assert.equal((await seenByOwner.json()).map.status, "failed");
});

test("a map reaches the browser without embeddings or document text", async () => {
  const { db, request, owner } = await repository();
  const vector = `[${Array.from({ length: 1536 }, () => EMBEDDING_VALUE).join(",")}]`;
  for (const paper of [101, 102]) {
    await db.query(
      `INSERT INTO paper_semantic_embeddings (owner_user_id, project_id, folder_id, paper_id, ingestion_run_id, content_hash, representation_version, embedding_model, embedding_dimensions, embedding)
       VALUES ($1, $2, $3, $4, $5, repeat('c', 64), 'paper-semantic-document-v1', 'test-embedding', 1536, $6::vector)`,
      [OWNER, PROJECT, FOLDER, paper, run(paper - 100), vector]
    );
  }
  const MAP = "20000000-0000-4000-8000-000000000001";
  await db.query(
    `INSERT INTO repository_semantic_maps (id, owner_user_id, project_id, status, source_hash, representation_version, projection_algorithm, paper_count, clusters, completed_at)
     VALUES ($1, $2, $3, 'succeeded', repeat('a', 64), 'paper-semantic-document-v1', 'pca', 2, $4::jsonb, now())`,
    [MAP, OWNER, PROJECT, JSON.stringify([{ id: 0, label: "Feedback", paperCount: 2, terms: ["feedback"], source: "deterministic" }])]
  );
  for (const [paper, x, y] of [[101, 120, 340], [102, 610, 455]]) {
    await db.query(
      `INSERT INTO repository_semantic_points (map_id, owner_user_id, project_id, paper_id, ingestion_run_id, folder_id, x, y, cluster_id, title, year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, '2021')`,
      [MAP, OWNER, PROJECT, paper, run(paper - 100), FOLDER, x, y, `Paper ${paper}`]
    );
  }
  await db.query(
    `INSERT INTO repository_semantic_edges (map_id, owner_user_id, project_id, source_paper_id, target_paper_id, cosine_similarity, euclidean_distance, shared_signals)
     VALUES ($1, $2, $3, 101, 102, 0.8, 0.63, $4::jsonb)`,
    [MAP, OWNER, PROJECT, JSON.stringify({ categories: [], topics: [], keywords: ["feedback"], methods: [] })]
  );
  const { GET } = await import("../src/app/api/workspace/semantic-map/route");
  const job = await import("../src/app/api/workspace/semantic-map/jobs/[jobId]/route");

  const responses = [
    await GET(request(`/api/workspace/semantic-map?projectId=${PROJECT}`, { headers: owner })),
    await job.GET(request(`/api/workspace/semantic-map/jobs/${MAP}`, { headers: owner }), params({ jobId: MAP })),
  ];
  for (const response of responses) {
    assert.equal(response.status, 200);
    const text = await response.text();
    const { map } = JSON.parse(text);
    assert.deepEqual(map.points.map((point: { title: string }) => point.title), ["Paper 101", "Paper 102"]);
    assert.equal(map.edges.length, 1);
    assert.deepEqual(keysOf(map).filter((key) => /embedding|documentText/i.test(key)), []);
    assert.equal(text.includes(EMBEDDING_VALUE), false, "an embedding value reached the browser");
    assert.equal(text.includes(ABSTRACT), false, "the paper's document text reached the browser");
  }
});

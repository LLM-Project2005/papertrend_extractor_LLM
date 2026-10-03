/*
 * Routes called with hostile or replayed input, against PGlite under the app's
 * role (docs/32, long-term health). They replace text assertions in
 * security-surface, workspace-boot and dashboard-export. Storage, the
 * analysis worker and (for the retired Supabase upload) Supabase are stubbed
 * (tests/support/stub-bootsec-*.ts); the routes, guards and SQL run as written.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { paperIdFromRunId } from "../src/lib/paper-id";
import type { DashboardData } from "../src/types/database";
import { params, routeHarness, stubModule } from "./support/route-harness";
import { resolveServerOnlyAsServer } from "./support/stub-bootsec-server-only";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
resolveServerOnlyAsServer();
stubModule("/src/lib/gcs-signed-urls.ts", support("stub-bootsec-gcs.ts"));
stubModule("/src/lib/worker-queue-start.ts", support("stub-bootsec-worker-queue.ts"));
stubModule("/src/lib/supabase-admin.ts", support("stub-bootsec-supabase-admin.ts"));
stubModule("/src/lib/dashboard-data-server.ts", support("stub-bootsec-dashboard-loader.ts"));

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000c9";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a9";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const OTHER_FOLDER = "00000000-0000-4000-8000-0000000000f9";
const JOB = "00000000-0000-4000-8000-0000000000b1";

async function workspace(env: Record<string, string | undefined> = {}) {
  const harness = await routeHarness(env);
  const { clearVerifiedIdentities } = await import("../src/lib/auth/adapter");
  clearVerifiedIdentities();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('${ORG}', '${OWNER}', 'Mine'), ('${OTHER_ORG}', '${OTHER}', 'Theirs');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT}', '${ORG}', '${OWNER}', 'My repository', '{}'::jsonb, 2, 'test', now()),
      ('${OTHER_PROJECT}', '${OTHER_ORG}', '${OTHER}', 'Their private repository', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'A', '${PROJECT}'), ('${OTHER_FOLDER}', '${OTHER}', 'Z', '${OTHER_PROJECT}');
  `);
  return { ...harness, owner, other };
}

async function addRun(db: Awaited<ReturnType<typeof workspace>>["db"], run: string, fields: { owner?: string; folder?: string; status?: string; sourcePath?: string | null; job?: string | null; title?: string; year?: string; rawText?: string; body?: string } = {}) {
  const owner = fields.owner ?? OWNER;
  await db.query(
    `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, folder_analysis_job_id, source_type, status, source_filename, source_path, input_payload)
     VALUES ($1, $2, $3, $4, 'upload', $5, 'paper.pdf', $6, '{}'::jsonb)`,
    [run, owner, fields.folder ?? (owner === OWNER ? FOLDER : OTHER_FOLDER), fields.job ?? null, fields.status ?? "succeeded", fields.sourcePath === undefined ? "papers/x.pdf" : fields.sourcePath]
  );
  if (fields.title) {
    const paperId = paperIdFromRunId(run);
    await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [paperId, owner, fields.folder ?? FOLDER, fields.year ?? "2021", fields.title]);
    await db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, raw_text, body, ingestion_run_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [paperId, owner, fields.folder ?? FOLDER, fields.rawText ?? null, fields.body ?? "This study examines feedback in writing classes.", run]
    );
  }
}

/* ------------------------------------------------------------- uploads */

test("an upload is finalized once, from what storage itself reports", async () => {
  const { db, request, owner } = await workspace({ MAX_UPLOAD_BYTES: "4096", GCS_UPLOAD_BUCKET: "route-test-uploads" });
  await db.query(`INSERT INTO folder_analysis_jobs (id, owner_user_id, folder_id, status, total_runs) VALUES ($1, $2, $3, 'queued', 3)`, [JOB, OWNER, FOLDER]);
  const runs = { pdf: "11111111-1111-4111-8111-111111111111", large: "22222222-2222-4222-8222-222222222222", html: "33333333-3333-4333-8333-333333333333" };
  const path = (run: string) => `gs://route-test-uploads/pending/A/${run}/paper.pdf`;
  for (const run of Object.values(runs)) await addRun(db, run, { status: "processing", sourcePath: null, job: JOB });
  globalThis.__bootsecDeletedObjects = [];
  globalThis.__bootsecStoredObjects = {
    [path(runs.pdf)]: { sizeBytes: 2_000, contentType: "application/pdf" },
    // The browser said these were small PDFs; storage says otherwise.
    [path(runs.large)]: { sizeBytes: 5_000, contentType: "application/pdf" },
    [path(runs.html)]: { sizeBytes: 1_000, contentType: "text/html; charset=utf-8" },
  };
  const { POST } = await import("../src/app/api/admin/import/finalize/route");
  const finalize = (ids: string[]) =>
    POST(request("/api/admin/import/finalize", { headers: owner, body: { folderJobId: JOB, uploaded: ids.map((runId) => ({ runId, storagePath: path(runId), fileName: "paper.pdf" })) } }));

  assert.equal((await finalize(Object.values(runs))).status, 201);
  const states = async () =>
    Object.fromEntries((await db.query<{ id: string; status: string; error_message: string | null }>(`SELECT id, status, error_message FROM ingestion_runs`)).rows.map((row) => [row.id, [row.status, row.error_message]]));
  assert.deepEqual(await states(), {
    [runs.pdf]: ["queued", null],
    [runs.large]: ["failed", "The uploaded file is larger than the 0 MB limit."],
    [runs.html]: ["failed", "Only PDF files can be analyzed."],
  });
  assert.deepEqual(globalThis.__bootsecDeletedObjects.sort(), [path(runs.large), path(runs.html)].sort(), "a refused file is deleted at once");

  // The worker finishes the paper; finalizing it again must not queue it again.
  await db.query(`UPDATE ingestion_runs SET status = 'succeeded' WHERE id = $1`, [runs.pdf]);
  globalThis.__bootsecWorkerStarts = [];
  const replay = await finalize([runs.pdf]);
  assert.ok(replay.status < 300);
  assert.equal((await states())[runs.pdf][0], "succeeded", "a finished paper is not re-queued");
  assert.deepEqual(globalThis.__bootsecWorkerStarts, [], "and no analysis is started for it");
});

test("the legacy upload refuses a file that is not a PDF, whatever its name and type say", async () => {
  // The legacy route runs only off Cloud SQL; on Cloud SQL it is retired (410).
  await workspace({ DATABASE_PROVIDER: "supabase", ADMIN_IMPORT_SECRET: "import-secret-for-tests" });
  const { POST } = await import("../src/app/api/admin/import/route");
  const upload = (bytes: string) => {
    const form = new FormData();
    form.set("project_id", PROJECT);
    form.append("files", new File([bytes], "paper.pdf", { type: "application/pdf" }));
    return POST(new Request("https://papertrend.test/api/admin/import", { method: "POST", headers: { "x-admin-secret": "import-secret-for-tests" }, body: form }));
  };
  globalThis.__bootsecSupabaseCalls = [];
  const disguised = await upload("<html><script>alert(1)</script></html>");
  assert.equal(disguised.status, 400);
  assert.deepEqual(await disguised.json(), { error: "The file is not a valid PDF: paper.pdf" });
  assert.equal(globalThis.__bootsecSupabaseCalls.filter((call) => call.operation === "upload").length, 0, "nothing reaches storage");

  globalThis.__bootsecSupabaseCalls = [];
  const quiet = (["info", "warn", "error"] as const).map((level) => mock.method(console, level, () => undefined));
  try {
    await upload("%PDF-1.7\n%real enough\n");
  } finally {
    for (const spy of quiet) spy.mock.restore();
  }
  assert.equal(globalThis.__bootsecSupabaseCalls.filter((call) => call.operation === "upload").length, 1, "a PDF is stored");
});

/* ----------------------------------------------------- a paper's text */

test("a paper's stored text is cleaned in linear time, capped, and its sections found by their headings", async () => {
  const { db, request, owner } = await workspace();
  const run = "44444444-4444-4444-8444-444444444444";
  const methods = "Participants were 48 university students who wrote two drafts and exchanged peer feedback between them; their revisions were coded by two raters.";
  // A PDF's text is attacker-controlled. Long runs of unusual whitespace (no-break
  // spaces, a byte-order mark) made the old patterns superlinear: measured, the
  // old cleaning took 4 s on a run of 40,000 and grew with its square.
  const [nbsp, bom] = [String.fromCharCode(0xa0), String.fromCharCode(0xfeff)];
  const hostile = `Abstract\nA study of feedback.\n## Methods\n${methods}\nResults\n${nbsp.repeat(120_000)}x\n${` ${bom}`.repeat(10_000)}.\n${"word ".repeat(200_000)}`;
  await addRun(db, run, { title: "Peer feedback", rawText: hostile });
  const { GET } = await import("../src/app/api/workspace/library/[runId]/analysis/route");
  const started = performance.now();
  const response = await GET(request(`/api/workspace/library/${run}/analysis`, { headers: owner }), params({ runId: run }));
  const elapsed = performance.now() - started;
  assert.equal(response.status, 200);
  const { analysis } = await response.json();
  assert.ok(elapsed < 5_000, `took ${Math.round(elapsed)} ms`);
  // A million characters of words follow the whitespace; only what fits in 200,000 is read.
  assert.ok(analysis.raw_text.length > 50_000 && analysis.raw_text.length <= 200_000, `raw text of ${analysis.raw_text.length} characters`);
  assert.equal(analysis.methods.slice(0, methods.length), methods, "the Methods heading is found");
  assert.ok(analysis.warnings.some((warning: string) => /Recovered methods from heading-based fallback/.test(warning)));
  assert.ok(!analysis.raw_text.includes(nbsp) && !analysis.raw_text.includes(bom), "unusual whitespace is folded");
  assert.doesNotMatch(analysis.raw_text, / \./, "no space before punctuation");
});

/* ------------------------------------------------------ hostile values */

test("values reach the database as values: a hostile name or filter changes nothing else and reveals nothing", async () => {
  const { db, request, owner } = await workspace();
  const mine = "55555555-5555-4555-8555-555555555555";
  const theirs = "66666666-6666-4666-8666-666666666666";
  await addRun(db, mine);
  await addRun(db, theirs, { owner: OTHER });
  const hostile = `x', owner_user_id = '${OTHER}', display_name = 'y' WHERE true; DELETE FROM ingestion_runs; --`;
  const library = await import("../src/app/api/workspace/library/[runId]/route");
  const renamed = await library.PATCH(request(`/api/workspace/library/${mine}`, { method: "PATCH", headers: owner, body: { action: "rename", value: hostile } }), params({ runId: mine }));
  assert.equal(renamed.status, 200);
  const rows = await db.query<{ id: string; owner_user_id: string; display_name: string | null }>(`SELECT id, owner_user_id, display_name FROM ingestion_runs ORDER BY id`);
  assert.deepEqual(rows.rows, [
    { id: mine, owner_user_id: OWNER, display_name: hostile },
    { id: theirs, owner_user_id: OTHER, display_name: null },
  ]);

  const projects = await import("../src/app/api/workspace/projects/route");
  const folders = await import("../src/app/api/workspace/folders/route");
  const quiet = mock.method(console, "error", () => undefined);
  try {
    for (const filter of [`' OR '1'='1`, `${OTHER_ORG}' OR owner_user_id <> '${OWNER}`, OTHER_ORG]) {
      const response = await projects.GET(request(`/api/workspace/projects?organizationId=${encodeURIComponent(filter)}`, { headers: owner }));
      const text = await response.text();
      assert.ok(!text.includes("Their private repository"), filter);
    }
    for (const filter of [`' OR '1'='1`, OTHER_PROJECT]) {
      const response = await folders.GET(request(`/api/workspace/folders?projectId=${encodeURIComponent(filter)}`, { headers: owner }));
      const text = await response.text();
      assert.ok(!text.includes(OTHER_FOLDER), filter);
    }
  } finally {
    quiet.mock.restore();
  }
  const own = await (await projects.GET(request("/api/workspace/projects", { headers: owner }))).json();
  assert.deepEqual(own.projects.map((project: { name: string }) => project.name), ["My repository"], "the filter itself still works");
});

test("an owner named in the request body or address is ignored: what is made belongs to the caller", async () => {
  const { db, request, other } = await workspace();
  const organizations = await import("../src/app/api/workspace/organizations/route");
  const made = await organizations.POST(
    request(`/api/workspace/organizations?ownerUserId=${OWNER}&owner_user_id=${OWNER}`, { headers: other, body: { name: "Planted", ownerUserId: OWNER, owner_user_id: OWNER } })
  );
  assert.equal(made.status, 201);
  const planted = await db.query<{ owner_user_id: string }>(`SELECT owner_user_id FROM workspace_organizations WHERE name = 'Planted'`);
  assert.deepEqual(planted.rows, [{ owner_user_id: OTHER }]);
  const listed = await (await organizations.GET(request(`/api/workspace/organizations?ownerUserId=${OWNER}`, { headers: other }))).json();
  assert.ok(!JSON.stringify(listed).includes("Mine"), "the named owner's workspaces are not listed");
});

/* --------------------------------------------------------- the dashboard */

test("the dashboard sends the browser no topic-family evidence, which only the server reads", async () => {
  const { request, owner } = await workspace();
  const family = {
    id: "f",
    canonicalTopic: "Reading",
    aliases: [],
    representativeKeywords: [],
    relatedKeywords: [],
    matchedTerms: [],
    evidenceSnippets: ["a long passage from the paper"],
    paperIds: ["1"],
    folderIds: [],
    years: ["2019"],
    totalKeywordFrequency: 4,
  };
  globalThis.__bootsecDashboardServerData = { trends: [], tracksSingle: [], tracksMulti: [], topicFamilies: [family], useMock: false } as unknown as DashboardData;
  try {
    const { GET } = await import("../src/app/api/workspace/dashboard-data/route");
    const response = await GET(request(`/api/workspace/dashboard-data?projectId=${PROJECT}`, { headers: owner }));
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data.topicFamilies[0].evidenceSnippets, []);
    assert.equal(data.topicFamilies[0].totalKeywordFrequency, 4);
    assert.ok(!JSON.stringify(data).includes("a long passage"));
  } finally {
    globalThis.__bootsecDashboardServerData = undefined;
  }
});

test(
  "the dashboard refuses a caller with no valid session instead of answering with invented figures",
  async () => {
    const { request } = await workspace();
    const { GET } = await import("../src/app/api/workspace/dashboard-data/route");
    for (const headers of [{}, { authorization: "Bearer forged-token" }] as Array<Record<string, string>>) {
      const response = await GET(request(`/api/workspace/dashboard-data?projectId=${PROJECT}`, { headers }));
      assert.equal(response.status, 401, JSON.stringify(headers));
    }
  }
);

/* ------------------------------------------------------- the chat scope */

test("the chat's scope summary lists the years in scope once each, in order", async () => {
  const { db, request, owner, other } = await workspace();
  const years = { "71111111-1111-4111-8111-111111111111": "2023", "72222222-2222-4222-8222-222222222222": "2019", "73333333-3333-4333-8333-333333333333": "2023" };
  for (const [run, year] of Object.entries(years)) await addRun(db, run, { title: `Paper ${year}`, year });
  await addRun(db, "74444444-4444-4444-8444-444444444444", { owner: OTHER, title: "Theirs", year: "2001" });
  const { GET } = await import("../src/app/api/chat/scope-summary/route");
  const summary = await (await GET(request(`/api/chat/scope-summary?projectId=${PROJECT}`, { headers: owner }))).json();
  assert.equal(summary.eligiblePaperCount, 3);
  assert.deepEqual(summary.years, ["2019", "2023"]);
  const theirs = await (await GET(request("/api/chat/scope-summary", { headers: other }))).json();
  assert.deepEqual(theirs.years, ["2001"]);
});

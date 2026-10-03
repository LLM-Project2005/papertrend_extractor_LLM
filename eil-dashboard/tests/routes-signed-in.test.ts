/*
 * Routes called as a signed-in person, against PGlite (docs/32, long-term
 * health). Only Firebase's token check and the database connection are
 * swapped (tests/support/route-harness.ts); the session handling, the routes
 * and their SQL run as written, under row-level security.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { params, routeHarness } from "./support/route-harness";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const OTHER_FOLDER = "00000000-0000-4000-8000-0000000000f9";
const RUN = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
const OTHER_RUN = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

async function workspace() {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{}'::jsonb, 2, 'test', now()),
      ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Theirs', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES
      ('${FOLDER}', '${OWNER}', 'A', '00000000-0000-4000-8000-0000000000a1'),
      ('${OTHER_FOLDER}', '${OTHER}', 'Z', '00000000-0000-4000-8000-0000000000a9');
  `);
  for (const [run, who, folder] of [[RUN, OWNER, FOLDER], [OTHER_RUN, OTHER, OTHER_FOLDER]]) {
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload)
       VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb)`,
      [run, who, folder]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', 'Paper')`, [paperIdFromRunId(run), who, folder]);
  }
  return { ...harness, owner, other };
}

test("the harness runs every query as the app's role, under row-level security", async () => {
  const { db } = await workspace();
  // One of the tables Cloud SQL forces row-level security on (ingestion_runs is not one).
  for (const [run, who, project] of [[RUN, OWNER, "00000000-0000-4000-8000-0000000000a1"], [OTHER_RUN, OTHER, "00000000-0000-4000-8000-0000000000a9"]]) {
    await db.query(
      `INSERT INTO paper_retrieval_documents (owner_user_id, project_id, paper_id, ingestion_run_id, digest_markdown, content_hash) VALUES ($1, $2, $3, $4, 'd', repeat('a', 64))`,
      [who, project, paperIdFromRunId(run), run]
    );
  }
  const { withCloudSqlOwnerTransaction, withCloudSqlServiceTransaction } = await import("../src/lib/cloudsql/client");
  const seen = await withCloudSqlOwnerTransaction(OWNER, async (client) => {
    const role = await client.query<{ role: string }>("SELECT current_user AS role");
    const documents = await client.query<{ owner_user_id: string }>("SELECT owner_user_id FROM paper_retrieval_documents");
    return { role: role.rows[0].role, owners: documents.rows.map((row) => row.owner_user_id) };
  });
  assert.deepEqual(seen, { role: "papertrend_app", owners: [OWNER] }, "no WHERE clause, yet only the owner's document");
  const service = await withCloudSqlServiceTransaction((client) => client.query("SELECT 1 FROM paper_retrieval_documents"));
  assert.equal(service.rows.length, 0, "no owner context, no rows");
  await assert.rejects(
    withCloudSqlOwnerTransaction(OWNER, (client) =>
      client.query(`INSERT INTO paper_retrieval_documents (owner_user_id, project_id, paper_id, ingestion_run_id, digest_markdown, content_hash) VALUES ($1, $2, 1, $3, 'd', repeat('a', 64))`, [OTHER, "00000000-0000-4000-8000-0000000000a9", OTHER_RUN])
    ),
    /row-level security/,
    "a row for someone else is refused"
  );
});

test("a route refuses a token Firebase refuses, and a Firebase account with no Papertrend account", async () => {
  const { request, signIn } = await workspace();
  const { POST } = await import("../src/app/api/workspace/library/bulk/route");
  const stranger = await signIn("00000000-0000-4000-8000-0000000000ee", { unmapped: true });
  for (const headers of [{}, { authorization: "Bearer forged-token" }, stranger]) {
    const response = await POST(request("/api/workspace/library/bulk", { headers, body: { action: "trash", runIds: [RUN] } }));
    assert.equal(response.status, 401, JSON.stringify(headers));
  }
});

test("a bulk action changes the caller's own papers only, whatever ids the browser sends", async () => {
  const { db, request, owner, other } = await workspace();
  const { POST } = await import("../src/app/api/workspace/library/bulk/route");
  const trash = await POST(request("/api/workspace/library/bulk", { headers: owner, body: { action: "trash", runIds: [RUN, OTHER_RUN] } }));
  assert.equal(trash.status, 200);
  const body = await trash.json();
  assert.equal(body.changed, 1);
  assert.equal(body.skipped, 1);
  const rows = await db.query<{ id: string; trashed: boolean }>(`SELECT id, trashed_at IS NOT NULL AS trashed FROM ingestion_runs ORDER BY id`);
  assert.deepEqual(rows.rows, [{ id: RUN, trashed: true }, { id: OTHER_RUN, trashed: false }]);

  // The other person cannot restore it, and their own request sees only theirs.
  const restore = await POST(request("/api/workspace/library/bulk", { headers: other, body: { action: "restore", runIds: [RUN] } }));
  assert.equal((await restore.json()).changed, 0);
  const still = await db.query<{ trashed: boolean }>(`SELECT trashed_at IS NOT NULL AS trashed FROM ingestion_runs WHERE id = $1`, [RUN]);
  assert.equal(still.rows[0].trashed, true);

  const bad = await POST(request("/api/workspace/library/bulk", { headers: owner, body: { action: "trash", runIds: ["not-a-uuid"] } }));
  assert.equal(bad.status, 400);
});

test("only a signed-in admin makes, lists and revokes invite codes", async () => {
  const { request, signIn, owner } = await workspace();
  const admin = await signIn(ADMIN, { role: "admin" });
  const list = await import("../src/app/api/admin/invites/route");
  const one = await import("../src/app/api/admin/invites/[inviteId]/route");

  const refused = await list.POST(request("/api/admin/invites", { headers: owner, body: { label: "x" } }));
  assert.equal(refused.status, 403, "a member is refused");
  assert.equal((await list.GET(request("/api/admin/invites", { headers: owner }))).status, 403);

  const made = await list.POST(request("/api/admin/invites", { headers: admin, body: { label: "Pilot", maxUses: 2 } }));
  assert.equal(made.status, 201);
  assert.equal(made.headers.get("cache-control"), "no-store");
  const { code, invite } = await made.json();
  assert.match(code, /^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/);

  const listed = await (await list.GET(request("/api/admin/invites", { headers: admin }))).json();
  assert.equal(listed.invites.length, 1);
  assert.ok(!JSON.stringify(listed).includes(code.replaceAll("-", "")), "the code itself is never listed");
  assert.ok(!JSON.stringify(listed).includes(code), "the code itself is never listed");

  const memberRevoke = await one.DELETE(request(`/api/admin/invites/${invite.id}`, { method: "DELETE", headers: owner }), params({ inviteId: invite.id }));
  assert.equal(memberRevoke.status, 403);
  const revoked = await one.DELETE(request(`/api/admin/invites/${invite.id}`, { method: "DELETE", headers: admin }), params({ inviteId: invite.id }));
  assert.equal(revoked.status, 200);
  const after = await (await list.GET(request("/api/admin/invites", { headers: admin }))).json();
  assert.ok(after.invites[0].revoked_at ?? after.invites[0].revokedAt, "the invite is marked revoked");
});

test("the Adaptive insights request is bounded before any work is done", async () => {
  const { request, owner } = await workspace();
  const { POST } = await import("../src/app/api/workspace/insights/route");
  const project = "00000000-0000-4000-8000-0000000000a1";
  const ask = (headers: Record<string, string>, body: unknown) => POST(request("/api/workspace/insights", { headers, body }));
  assert.equal((await ask({}, { projectId: project })).status, 401);
  for (const body of [
    {},
    { projectId: "not-a-uuid" },
    { projectId: project, searchQuery: "x".repeat(501) },
    { projectId: project, selectedYears: Array.from({ length: 81 }, (_, i) => String(1950 + i)) },
    { projectId: project, selectedYears: ["2020-and-a-long-label"] },
    { projectId: project, selectedTracks: Array.from({ length: 41 }, (_, i) => `track-${i}`) },
    { projectId: project, selectedTracks: ["x".repeat(81)] },
    { projectId: project, mode: "anything" },
  ]) {
    const response = await ask(owner, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.deepEqual(await response.json(), { error: "Malformed insights request." });
  }
});

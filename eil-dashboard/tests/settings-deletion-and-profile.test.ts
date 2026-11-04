/*
 * Settings round of 2026-11-05: deleting a repository or a whole account
 * yourself (against PGlite as the app's role, tests/support/route-harness.ts),
 * the uploaded profile picture, the sign-in panel's way back out of the invite
 * and confirm-your-email steps, and Rename asking in the page.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isAllowedAvatarUrl, isDisplayableAvatar } from "../src/lib/avatar";
import { params, routeHarness, stubModule } from "./support/route-harness";

// Storage is a stand-in that records each delete (globalThis.__bootsecDeletedObjects).
stubModule("/src/lib/gcs-signed-urls.ts", new URL("./support/stub-bootsec-gcs.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";
const ORG = "10000000-0000-4000-8000-0000000000c1";
const KEEP = "20000000-0000-4000-8000-0000000000c1";
const DOOMED = "20000000-0000-4000-8000-0000000000c2";
const KEEP_FOLDER = "30000000-0000-4000-8000-0000000000c1";
const DOOMED_FOLDER = "30000000-0000-4000-8000-0000000000c2";
const OTHER_ORG = "10000000-0000-4000-8000-0000000000c2";
const OTHER_PROJECT = "20000000-0000-4000-8000-0000000000c3";
const OTHER_FOLDER = "30000000-0000-4000-8000-0000000000c3";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

async function seed(db: Awaited<ReturnType<typeof routeHarness>>["db"]) {
  await db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES
      ('${ORG}', '${OWNER}', 'Personal repositories'),
      ('${OTHER_ORG}', '${OTHER}', 'Personal repositories');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${KEEP}', '${ORG}', '${OWNER}', 'Keep me', '{}', 1, 'h', now()),
      ('${DOOMED}', '${ORG}', '${OWNER}', 'Old reading list', '{}', 1, 'h', now()),
      ('${OTHER_PROJECT}', '${OTHER_ORG}', '${OTHER}', 'Old reading list', '{}', 1, 'h', now());
    INSERT INTO research_folders (id, owner_user_id, organization_id, project_id, name) VALUES
      ('${KEEP_FOLDER}', '${OWNER}', '${ORG}', '${KEEP}', 'Papers'),
      ('${DOOMED_FOLDER}', '${OWNER}', '${ORG}', '${DOOMED}', 'Papers'),
      ('${OTHER_FOLDER}', '${OTHER}', '${OTHER_ORG}', '${OTHER_PROJECT}', 'Papers');
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, input_payload) VALUES
      ('40000000-0000-4000-8000-0000000000c1', '${OWNER}', '${KEEP_FOLDER}', 'upload', 'succeeded', '{"paper_id": 101}'),
      ('40000000-0000-4000-8000-0000000000c2', '${OWNER}', '${DOOMED_FOLDER}', 'upload', 'succeeded', '{"paper_id": 102}'),
      ('40000000-0000-4000-8000-0000000000c3', '${OWNER}', '${DOOMED_FOLDER}', 'upload', 'failed', '{"paper_id": 103}'),
      ('40000000-0000-4000-8000-0000000000c4', '${OTHER}', '${OTHER_FOLDER}', 'upload', 'succeeded', '{"paper_id": 104}');
    INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES
      (101, '${OWNER}', '${KEEP_FOLDER}', '2020', 'Kept paper'),
      (102, '${OWNER}', '${DOOMED_FOLDER}', '2021', 'Doomed paper'),
      (103, '${OWNER}', '${DOOMED_FOLDER}', '2022', 'Doomed failed paper'),
      (104, '${OTHER}', '${OTHER_FOLDER}', '2023', 'Someone else''s paper');
    INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES
      (101, '${OWNER}', '${KEEP_FOLDER}', 'T', 'k'),
      (102, '${OWNER}', '${DOOMED_FOLDER}', 'T', 'k'),
      (104, '${OTHER}', '${OTHER_FOLDER}', 'T', 'k');
    INSERT INTO workspace_threads (id, owner_user_id, title) VALUES
      ('50000000-0000-4000-8000-0000000000c1', '${OWNER}', 'A chat'),
      ('50000000-0000-4000-8000-0000000000c2', '${OTHER}', 'Their chat');
    INSERT INTO workspace_messages (thread_id, owner_user_id, role, content) VALUES
      ('50000000-0000-4000-8000-0000000000c1', '${OWNER}', 'user', 'q'),
      ('50000000-0000-4000-8000-0000000000c2', '${OTHER}', 'user', 'q');
    INSERT INTO ai_usage_events (owner_user_id, usage_kind) VALUES ('${OWNER}', 'chat_message'), ('${OTHER}', 'chat_message');
    UPDATE ingestion_runs SET source_path = 'gs://route-test-uploads/doomed.pdf' WHERE id = '40000000-0000-4000-8000-0000000000c2';
  `);
  globalThis.__bootsecDeletedObjects = [];
}

const count = async (db: Awaited<ReturnType<typeof routeHarness>>["db"], sql: string) =>
  Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0].n);

test("deleting a repository takes its papers and analysis, and nothing of another repository or person", async () => {
  const { db, signIn, request } = await routeHarness();
  const auth = await signIn(OWNER, { email: "owner@papertrend.test" });
  await signIn(OTHER, { email: "other@papertrend.test" });
  await seed(db);
  const { DELETE } = await import("../src/app/api/workspace/projects/[projectId]/route");
  const call = (projectId: string, body: unknown) =>
    DELETE(request(`/api/workspace/projects/${projectId}`, { method: "DELETE", headers: auth, body }), params({ projectId }));

  // The typed name must match.
  const wrongName = await call(DOOMED, { confirmName: "Old reading" });
  assert.equal(wrongName.status, 409);
  assert.match((await wrongName.json()).error, /doesn't match/);
  // Another person's repository with the same name is not found.
  assert.equal((await call(OTHER_PROJECT, { confirmName: "Old reading list" })).status, 409);

  const response = await call(DOOMED, { confirmName: "Old reading list" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, papers: 2 });
  assert.deepEqual(globalThis.__bootsecDeletedObjects, ["gs://route-test-uploads/doomed.pdf"]);

  assert.equal(await count(db, `workspace_projects WHERE id = '${DOOMED}'`), 0);
  assert.equal(await count(db, `research_folders WHERE id = '${DOOMED_FOLDER}'`), 0);
  assert.equal(await count(db, "papers WHERE id IN (102, 103)"), 0);
  assert.equal(await count(db, "paper_keywords WHERE paper_id = 102"), 0);
  assert.equal(await count(db, `ingestion_runs WHERE folder_id = '${DOOMED_FOLDER}'`), 0);
  // The rest stays: the other repository, the chat, the other person's same-named repository.
  assert.equal(await count(db, "papers WHERE id IN (101, 104)"), 2);
  assert.equal(await count(db, `workspace_projects WHERE id IN ('${KEEP}', '${OTHER_PROJECT}')`), 2);
  assert.equal(await count(db, `workspace_threads WHERE owner_user_id = '${OWNER}'`), 1);
});

test("a repository with a paper still being analysed is not deleted", async () => {
  const { db, signIn, request } = await routeHarness();
  const auth = await signIn(OWNER, { email: "owner@papertrend.test" });
  await signIn(OTHER, { email: "other@papertrend.test" });
  await seed(db);
  await db.exec(`UPDATE ingestion_runs SET status = 'processing' WHERE id = '40000000-0000-4000-8000-0000000000c3'`);
  const { DELETE } = await import("../src/app/api/workspace/projects/[projectId]/route");
  const response = await DELETE(
    request(`/api/workspace/projects/${DOOMED}`, { method: "DELETE", headers: auth, body: { confirmName: "Old reading list" } }),
    params({ projectId: DOOMED })
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /still being analysed/);
  assert.equal(await count(db, "papers WHERE id IN (102, 103)"), 2);
});

test("deleting an account removes everything it owns and its sign-in, and nothing of anyone else", async () => {
  const { db, signIn, request } = await routeHarness();
  const auth = await signIn(OWNER, { email: "Owner@Papertrend.test" });
  await signIn(OTHER, { email: "other@papertrend.test" });
  await seed(db);
  const { DELETE } = await import("../src/app/api/account/route");
  const call = (body: unknown, headers = auth) => DELETE(request("/api/account", { method: "DELETE", headers, body }));

  const wrong = await call({ confirmEmail: "other@papertrend.test" });
  assert.equal(wrong.status, 409);
  assert.equal(await count(db, `user_profiles WHERE id = '${OWNER}'`), 1);

  // The email is matched without regard to case.
  const response = await call({ confirmEmail: "owner@papertrend.test" });
  assert.equal(response.status, 200);

  for (const table of [
    "user_profiles WHERE id",
    "auth_identity_mappings WHERE owner_user_id",
    "workspace_organizations WHERE owner_user_id",
    "workspace_projects WHERE owner_user_id",
    "research_folders WHERE owner_user_id",
    "ingestion_runs WHERE owner_user_id",
    "papers WHERE owner_user_id",
    "paper_keywords WHERE owner_user_id",
    "workspace_threads WHERE owner_user_id",
    "workspace_messages WHERE owner_user_id",
    "ai_usage_events WHERE owner_user_id",
  ]) {
    assert.equal(await count(db, `${table} = '${OWNER}'`), 0, table);
  }
  assert.equal(await count(db, `user_profiles WHERE id = '${OTHER}'`), 1);
  assert.equal(await count(db, `papers WHERE owner_user_id = '${OTHER}'`), 1);
  assert.equal(await count(db, `workspace_messages WHERE owner_user_id = '${OTHER}'`), 1);
  const state = globalThis.__papertrendRouteHarness as { deletedFirebaseUids?: string[] } | undefined;
  assert.equal(state?.deletedFirebaseUids?.length, 1);
  // The token that asked no longer reaches an account.
  assert.equal((await call({ confirmEmail: "owner@papertrend.test" })).status, 401);
});

test("an admin account is not deleted from Settings", async () => {
  const { db, signIn, request } = await routeHarness();
  const auth = await signIn(OWNER, { email: "owner@papertrend.test", role: "admin" });
  const { DELETE } = await import("../src/app/api/account/route");
  const response = await DELETE(request("/api/account", { method: "DELETE", headers: auth, body: { confirmEmail: "owner@papertrend.test" } }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /admin/);
  assert.equal(await count(db, `user_profiles WHERE id = '${OWNER}'`), 1);
});

test("a profile picture is an https link or a small uploaded image, nothing else", () => {
  assert.equal(isAllowedAvatarUrl(""), true);
  assert.equal(isAllowedAvatarUrl(null), true);
  assert.equal(isAllowedAvatarUrl("https://lh3.googleusercontent.com/a/photo"), true);
  assert.equal(isAllowedAvatarUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg=="), true);
  assert.equal(isAllowedAvatarUrl("http://example.com/a.png"), false);
  assert.equal(isAllowedAvatarUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedAvatarUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isAllowedAvatarUrl("data:text/html;base64,PGI+"), false);
  assert.equal(isAllowedAvatarUrl(`data:image/jpeg;base64,${"A".repeat(200_000)}`), false);
  assert.equal(isDisplayableAvatar(""), false);
  // Settings offers an upload, not a box for a link.
  const settings = source("components/workspace/WorkspaceSettingsClient.tsx");
  assert.match(settings, /type="file"/);
  assert.match(settings, /Upload picture/);
  assert.doesNotMatch(settings, /placeholder="https:\/\/"/);
});

test("the profile route refuses a picture that is not an image", async () => {
  const { signIn, request } = await routeHarness();
  const auth = await signIn(OWNER, { email: "owner@papertrend.test" });
  const { PATCH } = await import("../src/app/api/auth/profile/route");
  const refused = await PATCH(request("/api/auth/profile", { method: "PATCH", headers: auth, body: { avatar_url: "data:text/html;base64,PGI+" } }));
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /picture/);
  const accepted = await PATCH(
    request("/api/auth/profile", { method: "PATCH", headers: auth, body: { avatar_url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" } })
  );
  assert.equal(accepted.status, 200);
});

test("signing out ends the invite and confirm-email steps, so their buttons lead back to sign-in", () => {
  const provider = source("components/auth/AuthProvider.tsx");
  const signedOutBranch = provider.slice(provider.indexOf("if (!firebaseUser) {"), provider.indexOf("let firebaseSession"));
  assert.match(signedOutBranch, /setAuthErrorCode\(null\)/);
  const panel = source("components/auth/AuthPanel.tsx");
  assert.match(panel, /Wrong address\? Start again/);
  // The password can be shown while typing.
  assert.match(panel, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(panel, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
});

test("Rename on the repository list asks in the page, not in the browser's prompt", () => {
  const index = source("components/workspace/workspaces/ProjectIndexClient.tsx");
  assert.doesNotMatch(index, /window\.prompt/);
  assert.match(index, /title="Rename repository"/);
});

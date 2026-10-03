/*
 * No signed-in reader is shown invented data, run rather than read: the
 * dashboard's data hook is rendered as it first draws, and the dashboard
 * data route is called with the retired ?mode=mock against PGlite under the
 * app's role (tests/support/route-harness.ts). Sign-in for the hook is
 * swapped (tests/support/stub-auditfix-auth.ts); the hook, the route and the
 * server read run as written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { paperIdFromRunId } from "../src/lib/paper-id";
import type { DashboardData } from "../src/types/database";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/components/auth/AuthProvider.tsx", new URL("./support/stub-auditfix-auth.ts", import.meta.url).href);
(globalThis as { React?: typeof React }).React = React;

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const RUN = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";

test("the dashboard's data hook draws nothing before its data arrives, signed in or not yet", async () => {
  // The moment after mount, before the session hydrated, used to hand back
  // eleven years of invented topics.
  const { useDashboardData } = await import("../src/hooks/useData");
  const seen: Array<ReturnType<typeof useDashboardData>> = [];
  function Probe() {
    seen.push(useDashboardData("all", [], { mode: "auto", projectId: PROJECT, enabled: true }));
    return null;
  }
  for (const auth of [{ hydrated: false }, { hydrated: true, user: { id: OWNER }, session: { access_token: "token" } }]) {
    globalThis.__auditfixAuth = auth;
    seen.length = 0;
    renderToStaticMarkup(createElement(Probe));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].data, null, JSON.stringify(auth));
    assert.equal(seen[0].loading, true);
  }
  globalThis.__auditfixAuth = undefined;
});

test("asking the dashboard route for ?mode=mock returns the reader's own papers", async () => {
  const { db, signIn, request } = await routeHarness();
  const owner = await signIn(OWNER);
  await db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Mine', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'A', '${PROJECT}');
  `);
  const paper = paperIdFromRunId(RUN);
  await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status) VALUES ($1, $2, $3, 'upload', 'succeeded')`, [RUN, OWNER, FOLDER]);
  await db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', 'Peer feedback in writing')`, [paper, OWNER, FOLDER]);
  await db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id) VALUES ($1, $2, $3, $4)`, [paper, OWNER, FOLDER, RUN]);
  await db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, 'Peer Feedback', 'peer feedback')`, [paper, OWNER, FOLDER]);

  const { GET } = await import("../src/app/api/workspace/dashboard-data/route");
  for (const mode of ["mock", "live", ""]) {
    const response = await GET(request(`/api/workspace/dashboard-data?projectId=${PROJECT}${mode ? `&mode=${mode}` : ""}&fresh=1`, { headers: owner }));
    assert.equal(response.status, 200, mode);
    const { data } = (await response.json()) as { data: DashboardData };
    assert.deepEqual([...new Set(data.trends.map((entry) => String(entry.paper_id)))], [String(paper)], `mode=${mode}: only the reader's paper`);
    assert.deepEqual([...new Set(data.trends.map((entry) => entry.title))], ["Peer feedback in writing"]);
    assert.notEqual(data.diagnostics?.dataSource, "mock", mode);
    assert.equal(data.useMock, false, mode);
  }
});

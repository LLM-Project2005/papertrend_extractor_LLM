import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasUsableAnalysis, usableAnalysisSql } from "../src/lib/usable-analysis";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { routeHarness, stubModule } from "./support/route-harness";
import { captured, elementsOf, headlessRoot, textOf } from "./support/stub-smallfix-root";

/*
 * Re-analysis does not take a paper out of chat or the semantic map; cancel
 * restores it (docs/32, 2.4). The readers and Cancel all run against PGlite
 * under the app's role (tests/support/route-harness.ts); Home, chat and the
 * workspace tray are drawn with sign-in, the workspace, the theme, the
 * dashboard data and Next's router swapped (tests/support/stub-auditfix-*.ts).
 */

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/hooks/useData.ts", support("stub-auditfix-dashboard-data.ts"));
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CASES = JSON.parse(read("tests/fixtures/usable-analysis-cases.json")) as Array<{
  name: string; status: string; input_payload: Record<string, unknown>; usable: boolean;
}>;

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE ingestion_runs (
      id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, status text NOT NULL, error_message text,
      completed_at timestamptz, updated_at timestamptz, input_payload jsonb NOT NULL DEFAULT '{}');
  `);
  return db;
}
const runId = (n: number) => `00000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
const OWNER = "00000000-0000-0000-0000-00000000000a";

test("the rule in TypeScript and in SQL agree on every case", async () => {
  const db = await database();
  for (const [index, item] of CASES.entries()) {
    assert.equal(hasUsableAnalysis(item), item.usable, item.name);
    await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, status, input_payload) VALUES ($1,$2,$3,$4)`, [runId(index), OWNER, item.status, item.input_payload]);
  }
  const usable = await db.query<{ id: string }>(`SELECT id FROM ingestion_runs ir WHERE ${usableAnalysisSql("ir")} ORDER BY id`);
  assert.deepEqual(usable.rows.map((row) => row.id), CASES.flatMap((item, index) => (item.usable ? [runId(index)] : [])));
  assert.equal(hasUsableAnalysis(null), false);
  await db.close();
});

test("canceling a re-analysis restores the earlier analysis; canceling a first analysis fails it", async () => {
  const { CANCEL_RUNS_SQL } = await import("../src/lib/cloudsql/analysis-job-repository");
  const db = await database();
  const other = "00000000-0000-0000-0000-00000000000b";
  const reanalysis = { reanalysis_requested_at: "2026-10-01T00:00:00Z", paper_id: "123", analysis_metrics: { completed_at: "2026-09-30T10:00:00Z" }, progress_stage: "queued" };
  await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, status, input_payload) VALUES
    ($1,$4,'processing',$5), ($2,$4,'queued','{}'), ($3,$6,'processing',$5)`, [runId(1), runId(2), runId(3), OWNER, reanalysis, other]);
  const now = "2026-10-01T01:00:00Z";
  const canceled = await db.query<{ id: string; status: string; error_message: string | null; completed_at: Date; input_payload: Record<string, unknown> }>(
    CANCEL_RUNS_SQL,
    [OWNER, [runId(1), runId(2), runId(3)], now, JSON.stringify({ progress_stage: "failed", canceled_by_user: true }), JSON.stringify({ progress_stage: "completed", reanalysis_canceled_at: now })]
  );
  const byId = new Map(canceled.rows.map((row) => [row.id, row]));
  assert.equal(byId.size, 2, "another owner's run is untouched");
  const restored = byId.get(runId(1))!;
  assert.equal(restored.status, "succeeded");
  assert.equal(restored.error_message, null);
  assert.equal(new Date(restored.completed_at).toISOString(), "2026-09-30T10:00:00.000Z", "its earlier completion time");
  assert.equal(restored.input_payload.progress_stage, "completed");
  assert.equal(restored.input_payload.reanalysis_canceled_at, now);
  assert.equal((restored.input_payload.analysis_metrics as { completed_at: string }).completed_at, "2026-09-30T10:00:00Z", "the earlier analysis stays described");
  const failed = byId.get(runId(2))!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_message, "Canceled by user.");
  assert.equal(failed.input_payload.canceled_by_user, true);
  const untouched = await db.query<{ status: string }>(`SELECT status FROM ingestion_runs WHERE id=$1`, [runId(3)]);
  assert.equal(untouched.rows[0].status, "processing");
  await db.close();
});

/* ------------------------------------------------------- in the workspace */

const PERSON = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const RUNS = {
  finished: "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51",
  reanalysing: "2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52",
  firstAnalysis: "3a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c53",
  other: "4a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c54",
};

async function workspace() {
  const harness = await routeHarness();
  const person = await harness.signIn(PERSON);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${PERSON}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${PERSON}', 'Assessment', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${PERSON}', 'Papers', '${PROJECT}');
  `);
  /** A run with a stored analysis, as the worker leaves one. */
  const paper = async (run: string, status: string, payload: Record<string, unknown>, title: string) => {
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, folder_analysis_job_id, source_type, status, input_payload) VALUES ($1, $2, $3, NULL, 'upload', $4, $5::jsonb)`,
      [run, PERSON, FOLDER, status, JSON.stringify(payload)]
    );
    const id = paperIdFromRunId(run);
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [id, PERSON, FOLDER, title]);
    await harness.db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract) VALUES ($1, $2, $3, $4, $5)`, [id, PERSON, FOLDER, run, `${title}: an abstract.`]);
    await harness.db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, 'Feedback', 'peer feedback')`, [id, PERSON, FOLDER]);
  };
  return { ...harness, person, paper };
}

test("chat and the semantic map read a paper being re-analysed, and not one never analysed", async () => {
  const { paper } = await workspace();
  await paper(RUNS.finished, "succeeded", {}, "A finished paper");
  await paper(RUNS.reanalysing, "processing", { reanalysis_requested_at: "2026-10-01T00:00:00Z", paper_id: "1", analysis_metrics: { completed_at: "2026-09-30T10:00:00Z" } }, "A paper analysed again");
  await paper(RUNS.firstAnalysis, "processing", { paper_id: "1", analysis_metrics: { queue_wait_seconds: 3 } }, "A paper half written");

  const { loadRepositoryContext } = await import("../src/lib/repository-chat");
  const quiet = console.info;
  console.info = () => undefined;
  const context = await loadRepositoryContext({
    ownerUserId: PERSON,
    projectId: PROJECT,
    knowledgeScope: { kind: "project", projectId: PROJECT },
    prompt: "What do these papers say about feedback?",
  }).finally(() => (console.info = quiet));
  assert.deepEqual(context.papers.map((entry) => entry.title).sort(), ["A finished paper", "A paper analysed again"]);

  const { loadSemanticMapCoverage, loadSemanticPaperDocuments } = await import("../src/lib/semantic-map-repository");
  const documents = await loadSemanticPaperDocuments(PERSON, PROJECT);
  assert.deepEqual(documents.map((entry) => entry.runId).sort(), [RUNS.finished, RUNS.reanalysing].sort());
  assert.equal((await loadSemanticMapCoverage(PERSON, PROJECT)).eligiblePapers, 2);
});

test("Cancel all cancels the batch in view, never every run the person has", async () => {
  const { db, person, request } = await workspace();
  const JOB = "00000000-0000-4000-8000-0000000000b1";
  await db.query(
    `INSERT INTO folder_analysis_jobs (id, owner_user_id, folder_id, status, total_runs) VALUES ($1, $2, $3, 'processing', 2)`,
    [JOB, PERSON, FOLDER]
  );
  const add = (id: string, job: string | null) =>
    db.query(`INSERT INTO ingestion_runs (id, owner_user_id, folder_id, folder_analysis_job_id, source_type, status) VALUES ($1, $2, $3, $4, 'upload', 'processing')`, [id, PERSON, FOLDER, job]);
  await add(RUNS.finished, JOB);
  await add(RUNS.reanalysing, JOB);
  await add(RUNS.other, null);
  const { POST } = await import("../src/app/api/folder-analysis/cancel-all/route");
  const cancel = async (body: unknown) => {
    const response = await POST(request("/api/folder-analysis/cancel-all", { headers: person, body }));
    return { status: response.status, body: (await response.json()) as { error?: string; canceledRuns?: Array<{ id: string }> } };
  };
  const statuses = async () =>
    Object.fromEntries((await db.query<{ id: string; status: string }>(`SELECT id, status FROM ingestion_runs ORDER BY id`)).rows.map((row) => [row.id, row.status]));

  assert.deepEqual(await cancel({}), { status: 400, body: { error: "Choose the analysis to cancel." } });
  assert.deepEqual(Object.values(await statuses()), ["processing", "processing", "processing"], "nothing was canceled");
  const byJob = await cancel({ folderJobId: JOB });
  assert.deepEqual(byJob.body.canceledRuns?.map((run) => run.id).sort(), [RUNS.finished, RUNS.reanalysing].sort());
  assert.equal((await statuses())[RUNS.other], "processing", "another upload carries on");
  const byRuns = await cancel({ runIds: [RUNS.other] });
  assert.deepEqual(byRuns.body.canceledRuns?.map((run) => run.id), [RUNS.other]);
});

test("Home's Cancel all names the batch it shows", async () => {
  const session = { folderJobId: "00000000-0000-4000-8000-0000000000b1", runIds: [RUNS.finished, RUNS.reanalysing], minimized: false };
  globalThis.__auditfixAuth = { user: { id: PERSON, email: "reader@papertrend.test" }, session: { access_token: "token" } };
  globalThis.__auditfixWorkspace = { currentProject: { id: PROJECT, name: "Assessment" }, hasActiveProject: true, selectedProjectId: PROJECT, analysisSession: session };
  const asked: unknown[] = [];
  const runs = {
    runs: [],
    folderJob: null,
    cancelAllActiveRuns: async (scope: unknown) => (asked.push(scope), []),
  };
  const { default: WorkspaceHomeClient } = await import("../src/components/workspace/WorkspaceHomeClient");
  const { default: AnalysisStatusCard } = await import("../src/components/workspace/AnalysisStatusCard");
  const { AnalysisRunsContext } = await import("../src/components/workspace/AnalysisRunsContext");
  let tree: ReactNode = null;
  function Capture() {
    tree = WorkspaceHomeClient();
    return null;
  }
  renderToStaticMarkup(createElement(AnalysisRunsContext.Provider, { value: runs as never }, createElement(Capture)));
  const card = elementsOf(tree).find((element) => element.type === AnalysisStatusCard);
  assert.ok(card, "Home shows the analysis it follows");
  await (card.props.onCancelAll as () => Promise<void>)();
  assert.deepEqual(asked, [{ folderJobId: session.folderJobId, runIds: session.runIds }]);
});

/*
 * The pages below run their effects through React's client renderer without a
 * document (tests/support/stub-smallfix-root.ts), so they come last: a server
 * render after them would find a window. The Library's menu for a paper being
 * re-analysed is run in small-fixes-behaviour-library.test.ts.
 */

const at = new Date(Date.now() - 60_000).toISOString();
const listed = (id: string, title: string, status: string, payload: Record<string, unknown> = {}) =>
  ({ id, source_type: "upload", status, display_name: title, source_filename: `${title}.pdf`, folder_id: FOLDER, created_at: at, updated_at: at, input_payload: payload });

test("papers sent to chat keep one being re-analysed, and leave out one never analysed", async () => {
  // From the semantic map or a dashboard drilldown, papers reach chat by way of
  // the browser's storage; chat asks the Library for them.
  const { writeChatScopeTransfer } = await import("../src/lib/chat-scope-transfer");
  const root = await headlessRoot();
  const runs = [
    listed(RUNS.finished, "A finished paper", "succeeded"),
    listed(RUNS.reanalysing, "A paper analysed again", "processing", { reanalysis_requested_at: "2026-10-01T00:00:00Z", paper_id: "1", analysis_metrics: { completed_at: "2026-09-30T10:00:00Z" } }),
    listed(RUNS.firstAnalysis, "A paper half read", "processing", { paper_id: "1", analysis_metrics: { queue_wait_seconds: 3 } }),
  ];
  writeChatScopeTransfer((globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage, { projectId: PROJECT, runIds: runs.map((entry) => entry.id) });
  globalThis.__auditfixAuth = { user: { id: PERSON, email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = { currentProject: { id: PROJECT, name: "Assessment" }, hasActiveProject: true, selectedProjectId: PROJECT, allProjects: [{ id: PROJECT, name: "Assessment" }], selectedYears: [], selectedTracks: [], searchQuery: "" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input) === `/api/workspace/library?projectId=${PROJECT}`) return Response.json({ runs });
    return Response.json({});
  }) as typeof fetch;
  try {
    const { default: ChatClient } = await import("../src/components/chat/ChatClient");
    let tree: ReactNode = null;
    await root.render(captured(ChatClient, {} as never, (next) => (tree = next)));
    await root.act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    const shown = textOf(tree);
    assert.match(shown, /Searching 2 selected papers/);
    assert.ok(shown.includes("A finished paper") && shown.includes("A paper analysed again"));
    assert.ok(!shown.includes("A paper half read"), "a first analysis still running is left out");
  } finally {
    await root.unmount();
    globalThis.fetch = realFetch;
  }
});

test("the workspace tray's Cancel all names the batch it shows", async () => {
  const root = await headlessRoot();
  globalThis.__auditfixAuth = { hydrated: true, user: { id: PERSON, email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  const workspace = { currentProject: { id: PROJECT, name: "Assessment" }, hasActiveProject: true, selectedProjectId: PROJECT, allProjects: [{ id: PROJECT, name: "Assessment" }] };
  globalThis.__auditfixWorkspace = { ...workspace, analysisSession: null };
  globalThis.__auditfixPathname = "/workspace/library";
  const sent: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === "/api/folder-analysis/cancel-all") sent.push(JSON.parse(String(init?.body)));
    return Response.json({ runs: [], canceledRuns: [] });
  }) as typeof fetch;
  try {
    const { default: WorkspaceShell } = await import("../src/components/workspace/WorkspaceShell");
    const { default: AnalysisStatusCard } = await import("../src/components/workspace/AnalysisStatusCard");
    let tree: ReactNode = null;
    const draw = () => root.render(captured(WorkspaceShell, { children: null }, (next) => (tree = next)));
    await draw();
    // A new upload starts: the tray opens on it.
    const session = { folderJobId: "00000000-0000-4000-8000-0000000000b1", runIds: [RUNS.finished, RUNS.reanalysing], minimized: false };
    globalThis.__auditfixWorkspace = { ...workspace, analysisSession: session };
    await draw();
    const card = elementsOf(tree).find((element) => element.type === AnalysisStatusCard);
    assert.ok(card, "the tray shows the analysis it follows");
    await root.act(() => (card.props.onCancelAll as () => Promise<void>)());
    assert.deepEqual(sent, [{ folderJobId: session.folderJobId, runIds: session.runIds }]);
  } finally {
    await root.unmount();
    globalThis.fetch = realFetch;
    globalThis.__auditfixPathname = undefined;
  }
});

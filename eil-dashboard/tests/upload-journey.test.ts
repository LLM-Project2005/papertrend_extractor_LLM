import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TRACK_COLS } from "../src/lib/constants";
import {
  getRunDisplayTitle,
  getRunPaperTitle,
  getRunStatusLabel,
} from "../src/lib/ingestion-status";
import {
  defaultWorkspaceFilters,
  filtersForProject,
  parseFiltersByProject,
  withProjectFilters,
} from "../src/lib/workspace-filters";
import { paperIdForRun, paperIdFromRunId } from "../src/lib/paper-id";
import type { IngestionRunRow } from "../src/types/database";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

function run(overrides: Partial<IngestionRunRow>): IngestionRunRow {
  return { id: "run-1", source_type: "upload", status: "succeeded", ...overrides };
}

/* ---------------------------------------------------------------- naming */

test("a paper is called by its title once analysed, not by its file", () => {
  const analysed = run({ source_filename: "plosive.pdf", paper_title: "Voice Onset Time in Thai Learners" });
  assert.equal(getRunDisplayTitle(analysed), "Voice Onset Time in Thai Learners");
  // The worker also stores the title on the run, for the progress card.
  assert.equal(
    getRunPaperTitle(run({ source_filename: "a.pdf", input_payload: { paper_title: "  Stored Title " } })),
    "Stored Title"
  );
  // An upload's display name starts as its file name (as on the pilot), which
  // must not hide the title; a name the reader gave the file does win.
  assert.equal(
    getRunDisplayTitle(run({ source_filename: "plosive.pdf", display_name: "plosive.pdf", paper_title: "English Plosive Consonants" })),
    "English Plosive Consonants"
  );
  assert.equal(
    getRunDisplayTitle(run({ source_filename: "plosive.pdf", display_name: "My name", paper_title: "Title" })),
    "My name"
  );
  // A paper not yet analysed keeps its file name.
  assert.equal(getRunDisplayTitle(run({ status: "queued", source_filename: "b.pdf" })), "b.pdf");
  assert.equal(getRunDisplayTitle(run({})), "Untitled paper");
});

test("statuses are words for a person", () => {
  assert.equal(getRunStatusLabel({ status: "succeeded" }), "Ready");
  assert.equal(getRunStatusLabel({ status: "processing" }), "Analyzing");
  assert.equal(getRunStatusLabel({ status: "queued" }), "Queued");
  assert.equal(getRunStatusLabel({ status: "failed" }), "Failed");
});

test("the Library list finds each paper's title through the run, not the rounded payload id", () => {
  const repository = read("src/lib/cloudsql/library-repository.ts");
  // On the pilot, 14 of 44 analysed runs had a payload paper_id rounded by a
  // JavaScript round trip (1093441516503213200), so a join on it missed them.
  assert.match(repository, /SELECT r\.\*, paper\.title AS paper_title/);
  assert.match(repository, /c\.owner_user_id = r\.owner_user_id AND c\.ingestion_run_id = r\.id/);
  assert.doesNotMatch(repository, /input_payload->>'paper_id'/);
  // The run table's filters name their table.
  assert.match(repository, /"r\.owner_user_id = \$1"/);
  assert.match(repository, /r\.folder_id = ANY/);
  assert.match(repository, /"r\.trashed_at IS NULL"/);
  const worker = read("worker/process_ingestion_queue.py");
  assert.match(worker, /"paper_title": paper_title\[:500\] or None/);
});

test("a copy keeps its payload exactly, because it never passes through JavaScript", () => {
  const repository = read("src/lib/cloudsql/library-repository.ts");
  const copy = repository.slice(repository.indexOf("async copyRun"), repository.indexOf("async listRuns"));
  assert.match(copy, /SELECT source\.input_payload FROM public\.ingestion_runs source WHERE source\.id = \$13/);
  assert.doesNotMatch(copy, /original\.input_payload/);
});

test("a run's paper id is never taken from a rounded number", () => {
  const runId = "0f2c1a7e-9b3d-4c55-8e21-7a6b5c4d3e2f";
  const exact = paperIdFromRunId(runId);
  assert.ok(BigInt(exact) > BigInt(Number.MAX_SAFE_INTEGER), "the worker's ids are wider than a double");
  // What JSON.parse makes of the stored number.
  const rounded = Number(exact);
  assert.notEqual(String(rounded), exact);
  assert.equal(paperIdForRun({ id: runId, input_payload: { paper_id: rounded } }), exact);
  // Exact forms are still used as they are.
  assert.equal(paperIdForRun({ id: runId, input_payload: { paper_id: "123" } }), "123");
  assert.equal(paperIdForRun({ id: runId, input_payload: { paper_id: 42 } }), "42");
  // A Library copy points at the paper of the run it copied.
  assert.equal(
    paperIdForRun({ id: "ffffffff-0000-0000-0000-000000000000", copied_from_run_id: runId, input_payload: { paper_id: rounded } }),
    exact
  );
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /return paperIdForRun\(run\);/);
});

/* ----------------------------------------------------------- debug tools */

test("no debug controls reach a reader", () => {
  const card = read("src/components/workspace/AnalysisStatusCard.tsx");
  assert.doesNotMatch(card, /onDebugClearQueue|Debug reset|Debug clear queue/);
  assert.doesNotMatch(card, /Supabase/);
  for (const relative of [
    "src/components/workspace/WorkspaceHomeClient.tsx",
    "src/components/workspace/WorkspaceShell.tsx",
    "src/hooks/useIngestionRuns.ts",
  ]) {
    assert.doesNotMatch(read(relative), /debugClearQueue|DebugClearQueue/, relative);
  }
});

/* --------------------------------------------------------- upload dialog */

test("the upload dialog fits its window and keeps its button in view", () => {
  const modal = read("src/components/workspace/AnalyzeFlowModal.tsx");
  // A one-line analysis profile inside a grid item made the whole dialog wider
  // than the screen, cut off on the right on desktop and on a phone.
  assert.match(modal, /w-\[min\(36rem,calc\(100vw-1\.5rem\)\)\] flex-col overflow-hidden/);
  assert.match(modal, /min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden/);
  assert.match(modal, /flex-none border-t/);
  assert.doesNotMatch(modal, /grid gap-4/);
});

test("the upload dialog offers only what works, and says what happens next", () => {
  const modal = read("src/components/workspace/AnalyzeFlowModal.tsx");
  assert.doesNotMatch(modal, /connector is planned|Coming soon|google-drive|Shared admin secret|x-admin-secret/);
  assert.match(modal, /What happens next/);
  assert.match(modal, /Keep this tab open until the upload finishes/);
  assert.match(modal, /Add papers to \$\{targetProject\.name\}/);
  assert.match(modal, /Follow progress/);
  assert.match(modal, /Open Library/);
  // The Library sends the repository being browsed.
  assert.match(modal, /projectId \? allProjects\.find\(\(project\) => project\.id === projectId\)/);
  assert.match(modal, /project_id: targetProjectId/);
});

test("clicking the corner progress card goes to the full progress", () => {
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /onExpand=\{\(\) => \{\s*setAnalysisMinimized\(false\);[\s\S]{0,160}router\.push\("\/workspace\/home"\)/);
  assert.match(shell, /analysisSessionKey !== seenAnalysisSessionKeyRef\.current/);
});

/* ---------------------------------------------------- filters per repository */

test("each repository keeps its own filters", () => {
  let store = parseFiltersByProject(null);
  store = withProjectFilters(store, "repo-a", { selectedYears: ["2019"], selectedTracks: ["EL"], searchQuery: "voice" });
  // Opening another repository starts clean instead of inheriting 2019.
  assert.deepEqual(filtersForProject(store, "repo-b"), defaultWorkspaceFilters());
  store = withProjectFilters(store, "repo-b", { selectedYears: ["2024"], selectedTracks: [...TRACK_COLS], searchQuery: "" });
  // And coming back restores what was set there.
  const restored = filtersForProject(parseFiltersByProject(JSON.stringify(store)), "repo-a");
  assert.deepEqual(restored, { selectedYears: ["2019"], selectedTracks: ["EL"], searchQuery: "voice" });
});

test("remembered filters survive bad storage and stay bounded", () => {
  for (const raw of ["", "not json", "[]", "null", '{"repo":5}']) {
    assert.deepEqual(filtersForProject(parseFiltersByProject(raw), "repo"), defaultWorkspaceFilters());
  }
  const partial = parseFiltersByProject('{"repo":{"selectedYears":["2020",3],"selectedTracks":[]}}');
  assert.deepEqual(filtersForProject(partial, "repo"), {
    selectedYears: ["2020"],
    selectedTracks: [...TRACK_COLS],
    searchQuery: "",
  });
  let store = {};
  for (let index = 0; index < 60; index += 1) {
    store = withProjectFilters(store, `repo-${index}`, defaultWorkspaceFilters());
  }
  assert.equal(Object.keys(store).length, 50);
  assert.ok("repo-59" in store && !("repo-0" in store), "the oldest repositories are forgotten first");
});

test("the provider restores filters with the repository they belong to", () => {
  const provider = read("src/components/workspace/WorkspaceProvider.tsx");
  assert.match(provider, /filtersForProject\(store, selectedProjectIdState\)/);
  assert.match(provider, /setFiltersProjectId\(selectedProjectIdState\)/);
  // Saved under the repository the filters were restored for, never the one
  // just switched to.
  assert.match(provider, /withProjectFilters\(store, filtersProjectId,/);
  assert.doesNotMatch(provider, /WORKSPACE_FILTERS_STORAGE_KEY/);
});

/* ------------------------------------------------------ adaptive charts */

test("Refresh is not announced as a filter change", () => {
  const dashboard = read("src/components/DashboardClient.tsx");
  const filterSignature = dashboard.slice(
    dashboard.indexOf("const adaptiveFilterSignature = useMemo("),
    dashboard.indexOf("// Charts planned for one repository")
  );
  // Only filters go into the signature that decides "Filters changed".
  assert.match(filterSignature, /selectedYears/);
  assert.doesNotMatch(filterSignature, /trendRows|topicFamilies|diagnostics/);
  assert.match(dashboard, /generatedAdaptiveFilterSignature && adaptiveFilterSignature !== generatedAdaptiveFilterSignature/);
  assert.match(dashboard, /The repository&apos;s data has changed since these charts were made/);
  // A plan made for one repository is dropped when another is opened.
  assert.match(dashboard, /adaptiveProjectRef\.current = selectedProjectId;\s*setPlanState\(null\);/);
});

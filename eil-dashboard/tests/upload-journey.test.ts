import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

/*
 * The upload journey (docs/30, docs/32). The Library's list, copies and the
 * progress card's payload are run against PGlite in
 * upload-spend-behaviour-uploads.test.ts.
 */

// The status card is compiled with the classic JSX runtime and does not import React itself.
(globalThis as { React?: typeof React }).React = React;

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

function run(overrides: Partial<IngestionRunRow>): IngestionRunRow {
  return { id: "run-1", source_type: "upload", status: "succeeded", ...overrides };
}

/** Every button and link in rendered markup, by its accessible name. */
function controls(html: string): string[] {
  return [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, , attributes, inner]) =>
    (attributes.match(/aria-label="([^"]*)"/)?.[1] ?? inner.replace(/<[^>]+>/g, "")).trim()
  );
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

test("the worker stores each paper's title on its run", () => {
  // Python, and no Python test covers this line, so it is read.
  const worker = read("worker/process_ingestion_queue.py");
  assert.match(worker, /"paper_title": paper_title\[:500\] or None/);
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
  // A Library copy is a paper of its own (docs/32, 2.5), not the one it was copied from.
  const copy = "ffffffff-0000-0000-0000-000000000000";
  assert.equal(
    paperIdForRun({ id: copy, copied_from_run_id: runId, input_payload: { paper_id: Number(paperIdFromRunId(copy)) } }),
    paperIdFromRunId(copy)
  );
  // A private helper of the Library, a client component too big to render here, so it is read.
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /return paperIdForRun\(run\);/);
});

/* ----------------------------------------------------------- debug tools */

test("no debug controls reach a reader", async () => {
  const { default: AnalysisStatusCard, AnalysisTrayPill } = await import("../src/components/workspace/AnalysisStatusCard");
  const noop = () => undefined;
  const handlers = {
    onMinimize: noop, onExpand: noop, onCollapse: noop, onClear: noop,
    onCancelRun: noop, onCancelAll: noop, onRetryQueue: noop, onStartProcessing: noop,
  };
  const quietSince = new Date(Date.now() - 10 * 60_000).toISOString();
  const batches: IngestionRunRow[][] = [
    [run({ id: "a", status: "queued", source_filename: "a.pdf", input_payload: { progress_stage: "queued" } })],
    [run({ id: "b", status: "processing", source_filename: "b.pdf", updated_at: quietSince, input_payload: { progress_stage: "extracting_text", progress_updated_at: quietSince } })],
    [
      run({ id: "c", status: "succeeded", paper_title: "Voice Onset Time", input_payload: { progress_stage: "completed" } }),
      run({ id: "d", status: "failed", source_filename: "d.pdf", error_message: "The PDF could not be read.", input_payload: { progress_stage: "failed" } }),
    ],
  ];
  const allowed =
    /^(Retry processing|Start processing now|Start now|Stop following|Dismiss|Minimize|Cancel all|Open library|Show all steps|Hide steps|Open the full analysis progress|Stop following this analysis \(it keeps running\)|Dismiss analysis status|Minimize analysis progress|Cancel analysis for .+|Open analysis progress: .+)$/;
  const seen = new Set<string>();
  for (const runs of batches) {
    for (const html of [
      renderToStaticMarkup(createElement(AnalysisStatusCard, { runs, ...handlers })),
      renderToStaticMarkup(createElement(AnalysisStatusCard, { runs, compact: true, ...handlers })),
      renderToStaticMarkup(createElement(AnalysisTrayPill, { runs, onOpen: noop, onClear: noop })),
    ]) {
      assert.doesNotMatch(html, /debug|supabase|clear queue/i);
      for (const control of controls(html)) {
        assert.match(control, allowed, control);
        seen.add(control);
      }
    }
  }
  for (const control of ["Retry processing", "Start processing now", "Cancel all", "Stop following", "Dismiss"]) {
    assert.ok(seen.has(control), `${control} was rendered`);
  }
  // The hook and the pages that held the old buttons need a browser and the app's providers to run, so they are read.
  for (const relative of [
    "src/components/workspace/WorkspaceHomeClient.tsx",
    "src/components/workspace/WorkspaceShell.tsx",
    "src/hooks/useIngestionRuns.ts",
  ]) {
    assert.doesNotMatch(read(relative), /debugClearQueue|DebugClearQueue/, relative);
  }
});

/* --------------------------------------------------------- upload dialog */

// The dialog needs the auth and workspace providers, the app router and a
// portal to render, and its layout a browser, so these two are read.
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
  assert.doesNotMatch(modal, /connector is planned|Coming soon|google-drive\/queue|Shared admin secret|x-admin-secret/);
  // Google Drive is offered only once the service has its Picker settings.
  assert.match(modal, /\{driveConfig \? \(/);
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
  // The shell needs the app's providers and router to render, so it is read.
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
  // Effects on the browser's storage inside the workspace provider; nothing here runs them, so it is read.
  const provider = read("src/components/workspace/WorkspaceProvider.tsx");
  assert.match(provider, /filtersForProject\(store, selectedProjectIdState\)/);
  assert.match(provider, /setFiltersProjectId\(selectedProjectIdState\)/);
  // Saved under the repository the filters were restored for, never the one
  // just switched to.
  assert.match(provider, /withProjectFilters\(store, filtersProjectId,/);
  assert.doesNotMatch(provider, /WORKSPACE_FILTERS_STORAGE_KEY/);
});

/* ------------------------------------------------------ adaptive charts */

test("the Adaptive insights follow the filters and the data, and never go stale", () => {
  // The old tab kept a snapshot and asked the reader to press "Update charts"
  // after every filter change. Insights are computed for free, so the tab
  // recomputes whenever the filters, the repository or its data change; a
  // slower earlier answer cannot overwrite a newer one. Debounced effects in
  // components that need the workspace providers and a browser, so read.
  const tab = read("src/components/dashboard/InsightsTab.tsx");
  assert.match(tab, /\(\) => \(\{ projectId, selectedYears, selectedTracks, searchQuery: searchQuery\.trim\(\) \}\)/);
  assert.match(tab, /const timer = window\.setTimeout\(\(\) => void load\("auto"\), 350\);/);
  assert.match(tab, /\}, \[load, dataVersion\]\);/);
  assert.match(tab, /if \(id !== requestId\.current\) return;/);
  const dashboard = read("src/components/DashboardClient.tsx");
  assert.match(dashboard, /dataVersion=\{adaptiveDataVersion\}/);
  assert.doesNotMatch(dashboard, /Filters changed\. Existing charts/);
});

/* -------------------------------------------------------------- progress */

test("progress under a paper describes the paper, not the queue machinery", async () => {
  // Seen under a fresh upload on the pilot: "1 Cloud Task queued the analysis
  // worker..." and "The worker is entering the paper analysis graph...".
  const { triggerWorkerQueueWithRetries } = await import("../src/lib/worker-queue-start");
  const saved = Object.fromEntries(
    ["WORKER_SERVICE_URL", "WORKER_WEBHOOK_SECRET", "K_SERVICE", "GOOGLE_CLOUD_PROJECT_ID"].map((key) => [key, process.env[key]])
  );
  const original = globalThis.fetch;
  process.env.WORKER_SERVICE_URL = "https://worker.papertrend.test";
  process.env.WORKER_WEBHOOK_SECRET = "webhook-secret-for-tests";
  delete process.env.K_SERVICE;
  delete process.env.GOOGLE_CLOUD_PROJECT_ID;
  // Cloud Tasks answers first; the direct worker call answers in turn, then refuses.
  const worker = (enqueue: unknown, ...direct: Array<[number, unknown]>) => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/enqueue-ingestion-tasks")) return Response.json(enqueue);
      const [status, body] = direct.shift() ?? [503, { error: "busy" }];
      return Response.json(body, { status });
    }) as typeof fetch;
  };
  const start = (options: { taskCount?: number } = {}) => triggerWorkerQueueWithRetries({ retryDelayMs: 100, ...options });
  try {
    const shown: string[] = [];
    const show = (result: Awaited<ReturnType<typeof start>>) => {
      shown.push(`${result.progressMessage} ${result.progressDetail}`);
      return result;
    };

    worker({ enqueued: true, task_count: 1 });
    assert.equal(show(await start()).progressDetail, "In line for analysis. It should start within a minute.");
    worker({ enqueued: true, task_count: 3 });
    assert.match(show(await start({ taskCount: 3 })).progressDetail, /^In line for analysis\. Papers are analyzed one after another/);
    worker({ enqueued: false }, [503, { error: "cold" }], [200, { queued: true }]);
    const second = show(await start());
    assert.equal(second.attempts, 2);
    assert.match(second.progressDetail, /^In line for analysis\. It took a second try/);
    worker({ enqueued: false }, [200, { queued: false, already_running: true }]);
    assert.equal(show(await start()).progressMessage, "Waiting for another analysis to finish");
    worker({ enqueued: false });
    const unstarted = show(await start());
    assert.equal(unstarted.progressStage, "queued_but_unstarted");
    assert.match(unstarted.progressDetail, /^The analysis service did not confirm that it started\./);
    process.env.WORKER_SERVICE_URL = "";
    assert.match(show(await start()).progressDetail, /^The analysis service is not set up in this environment\./);

    for (const line of shown) {
      assert.doesNotMatch(line, /Cloud Tasks?|worker|graph|Supabase/i, line);
    }
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the worker and the paper view keep the pipeline's machinery to themselves", () => {
  // Python with no Python test of its wording, and a paper view that needs the
  // workspace providers and a portal to render, so both are read.
  const worker = read("worker/process_ingestion_queue.py");
  assert.doesNotMatch(worker, /entering the paper analysis graph|claimed this run|from Supabase Storage before/);
  // The paper view no longer reports where its rows came from in pipeline terms.
  const paperView = read("src/components/workspace/PaperAnalysisExplorerModal.tsx");
  assert.doesNotMatch(paperView, /Canonical node output|Pipeline analysis ready/);
  // Its action buttons wrap rather than scroll sideways.
  assert.match(paperView, /<div className="mt-5 flex flex-wrap items-center gap-[\d.]+">/);
});

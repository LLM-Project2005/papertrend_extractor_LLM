import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import { TRAY_RUN_SQL } from "../src/lib/cloudsql/analysis-job-repository";
import {
  analysisSessionExpired,
  ANALYSIS_SESSION_MAX_AGE_MS,
  MAX_FOLLOWED_RUNS,
  mergeFollowedRunIds,
  trackedRunsSettled,
} from "../src/lib/run-polling";
import type { IngestionRunRow } from "../src/types/database";

/**
 * The progress tray follows its batch, however large, and stops polling when
 * done (docs/32, 2.6). Its status route is called in
 * upload-spend-behaviour-uploads.test.ts.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("polling stops once every followed run has finished or gone", () => {
  const runs = [{ id: "a", status: "succeeded" }, { id: "b", status: "failed" }, { id: "c", status: "processing" }];
  assert.equal(trackedRunsSettled(runs, ["a", "b", "c"]), false);
  assert.equal(trackedRunsSettled(runs, ["a", "b"]), true);
  assert.equal(trackedRunsSettled(runs, ["a", "gone"]), true, "a deleted run never comes back");
  assert.equal(trackedRunsSettled([{ id: "q", status: "queued" }], ["q"]), false);
});

test("a new batch joins the one followed, up to the limit, and a day-old session is dropped", () => {
  assert.deepEqual(mergeFollowedRunIds(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
  const many = Array.from({ length: MAX_FOLLOWED_RUNS + 5 }, (_, index) => `r${index}`);
  const merged = mergeFollowedRunIds(many.slice(0, 100), many.slice(100));
  assert.equal(merged.length, MAX_FOLLOWED_RUNS);
  assert.equal(merged.at(-1), many.at(-1), "the newest are kept");
  const now = Date.parse("2026-10-01T12:00:00Z");
  assert.equal(analysisSessionExpired("2026-10-01T00:00:00Z", now), false);
  assert.equal(analysisSessionExpired(new Date(now - ANALYSIS_SESSION_MAX_AGE_MS - 1).toISOString(), now), true);
  assert.equal(analysisSessionExpired("not a date", now), true);
});

test("the status query returns every followed run of the owner, with only what the tray reads", async () => {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec(read("cloudsql/schema.sql"));
  const owner = "00000000-0000-0000-0000-00000000000a";
  const other = "00000000-0000-0000-0000-00000000000b";
  await db.exec(`INSERT INTO user_profiles (id) VALUES ('${owner}'), ('${other}')`);
  const ids: string[] = [];
  for (let n = 0; n < 60; n += 1) {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    ids.push(id);
    await db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, source_type, status, input_payload) VALUES ($1, $2, 'upload', $3, $4::jsonb)`,
      [id, owner, n % 2 ? "succeeded" : "queued",
        `{"paper_id": 1152921504606846975, "progress_stage": "queued", "paper_title": "Paper ${n}", "raw_text_length": 99999, "analysis_metrics": {"completed_at": "2026-09-30T10:00:00Z", "model_usage": {"call_count": 11}}}`]
    );
  }
  const foreign = "00000000-0000-4000-8000-999999999999";
  await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, source_type, status) VALUES ($1, $2, 'upload', 'queued')`, [foreign, other]);
  const result = await db.query<{ id: string; input_payload: Record<string, unknown> }>(TRAY_RUN_SQL, [owner, [...ids, foreign]]);
  assert.equal(result.rows.length, 60, "no 25-run cap, and nobody else's run");
  const payload = result.rows[0].input_payload;
  assert.equal(payload.paper_id, "1152921504606846975", "the 60-bit id as exact text");
  assert.equal(payload.paper_title, "Paper 0");
  assert.equal(payload.raw_text_length, undefined, "fields the tray never reads are left out");
  assert.deepEqual(payload.analysis_metrics, { completed_at: "2026-09-30T10:00:00Z" });
  await db.close();
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("one poller, which waits while hidden and stops when done", () => {
  // Which components poll, and a hook driven by the browser's visibility events
  // inside the auth provider: nothing here can run them, so they are read.
  const callers = sourceFiles(join(root, "src"))
    .filter((path) => /useIngestionRuns\(\{/.test(readFileSync(path, "utf8")))
    .map((path) => path.replaceAll("\\", "/").replace(/.*\/src\//, "src/"))
    .filter((path) => path !== "src/hooks/useIngestionRuns.ts");
  assert.deepEqual(callers, ["src/components/workspace/WorkspaceShell.tsx"], "only the shell polls");
  assert.match(read("src/components/workspace/WorkspaceShell.tsx"), /<AnalysisRunsContext\.Provider value=\{analysisRuns\}>\{children\}<\/AnalysisRunsContext\.Provider>/);
  assert.match(read("src/components/workspace/WorkspaceHomeClient.tsx"), /\} = useAnalysisRuns\(\);/);
  const hook = read("src/hooks/useIngestionRuns.ts");
  assert.doesNotMatch(hook, /setInterval/);
  assert.match(hook, /if \(!enabled \|\| !requestHeaders \|\| pollingPausedForAuth \|\| settled\) \{/);
  assert.match(hook, /if \(document\.visibilityState === "hidden"\) return;/);
  assert.match(hook, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(hook, /if \(inFlightRef\.current\) return;/);
  assert.match(hook, /fetch\("\/api\/workspace\/runs\/status"/);
});

/** Every button in rendered markup, by its accessible name. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) =>
    (attributes.match(/aria-label="([^"]*)"/)?.[1] ?? inner.replace(/<[^>]+>/g, "")).trim()
  );
}

test("the tray can always be closed: Stop following while papers run, Dismiss once they finish", async () => {
  // The card is compiled with the classic JSX runtime and does not import React itself.
  (globalThis as { React?: typeof React }).React = React;
  const { default: AnalysisStatusCard, AnalysisTrayPill } = await import("../src/components/workspace/AnalysisStatusCard");
  const noop = () => undefined;
  const runs = (...statuses: Array<IngestionRunRow["status"]>) =>
    statuses.map((status, n): IngestionRunRow => ({ id: `r${n}`, source_type: "upload", status, source_filename: `${n}.pdf` }));
  const cases: Array<[IngestionRunRow[], string, string]> = [
    [runs("processing", "queued"), "Stop following this analysis (it keeps running)", "Stop following"],
    [runs("succeeded", "failed"), "Dismiss analysis status", "Dismiss"],
  ];
  for (const [batch, label, word] of cases) {
    const tray = buttons(renderToStaticMarkup(createElement(AnalysisStatusCard, { runs: batch, compact: true, onClear: noop })));
    assert.ok(tray.includes(label), `tray: ${label}`);
    const pill = buttons(renderToStaticMarkup(createElement(AnalysisTrayPill, { runs: batch, onOpen: noop, onClear: noop })));
    assert.ok(pill.includes(label), `pill: ${label}`);
    const card = buttons(renderToStaticMarkup(createElement(AnalysisStatusCard, { runs: batch, onClear: noop })));
    assert.ok(card.includes(word), `card: ${word}`);
  }
  // A batch whose runs cannot be found still has a way out.
  const lost = buttons(renderToStaticMarkup(createElement(AnalysisStatusCard, { runs: [], compact: true, onClear: noop })));
  assert.ok(lost.some((name) => cases.some(([, label]) => name === label)), lost.join(", "));
  // With nothing to close it with, nothing offers to.
  const bare = renderToStaticMarkup(createElement(AnalysisStatusCard, { runs: runs("processing"), compact: true }));
  assert.doesNotMatch(bare, /Stop following|Dismiss/);
});

test("the shell's pill closes the session, and a re-analysis follows what the server queued", () => {
  // Wiring inside the shell and the Library, which need the app's providers and router to render, so it is read.
  assert.match(read("src/components/workspace/WorkspaceShell.tsx"), /<AnalysisTrayPill runs=\{activeRuns\} onOpen=\{\(\) => setStatusPanelOpen\(true\)\} onClear=\{clearAnalysisSession\} \/>/);
  assert.match(read("src/components/admin/AdminImportClient.tsx"), /const queuedRuns = \[\.\.\.new Set\(payload\.queuedRunIds \?\? \[\]\)\]\.map\(\(id\) => \(\{ id \}\)\);/);
});

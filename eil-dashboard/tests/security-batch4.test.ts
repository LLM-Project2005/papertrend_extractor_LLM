import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { safeCitationHref } from "../src/lib/safe-citation-href";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a citation link is an internal path or http(s), never a script", () => {
  assert.equal(safeCitationHref("/workspace/library?paper=abc"), "/workspace/library?paper=abc");
  assert.equal(safeCitationHref("/docs/chat"), "/docs/chat");
  assert.equal(safeCitationHref("https://example.org/paper"), "https://example.org/paper");
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.example", "", "not a url"]) {
    assert.equal(safeCitationHref(bad), "#", bad);
  }
});

test("every citation renderer uses the scheme check", () => {
  // Web citation addresses come from a search provider's annotations. Two of
  // the three renderers used to pass them to href unchecked.
  const answer = read("src/components/chat/AnswerBody.tsx");
  assert.match(answer, /const safe = safeCitationHref\(href\);/, "evidenceHref checks first");
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /href=\{safeCitationHref\(citation\.href\)\}/);
  assert.match(chat, /<SourceLink href=\{safeCitationHref\(source\.href\)\}/, "research sources are checked");
  assert.doesNotMatch(chat, /<(Source)?Link href=\{source\.href\}/);
  // Checked first; only then does a paper open in place.
  assert.match(chat, /function SourceLink\(\{ href, className, children \}[^)]*\) \{\s*return parsePaperHref\(href\) \?/);
});

test("the Adaptive insights request carries no free text to the model", () => {
  // The old chart planner took a "context" object straight into a paid prompt.
  // The insights route takes only filters (their bounds are called in
  // routes-signed-in.test.ts); unknown fields are dropped, not passed on.
  const route = read("src/app/api/workspace/insights/route.ts");
  assert.doesNotMatch(route, /\.passthrough\(\)/);
  assert.doesNotMatch(route, /context:/);
});

test("parallel requests cannot all pass the daily limit", () => {
  // The limit, its kinds and its refusal when it cannot be checked run in
  // guards-behaviour.test.ts. PGlite has one connection, so what keeps
  // parallel requests from all reading the same count is pinned here.
  const guards = read("src/lib/security-guards.ts");
  const fn = guards.slice(guards.indexOf("export async function assertAndRecordAiUsage"));
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/, "count and insert are serialised");
  assert.ok(fn.indexOf("pg_advisory_xact_lock") < fn.indexOf("client.query<{ count: string }>(AI_USAGE_COUNT_SQL"), "the lock comes before the count");
});

test("one person has at most two answers in flight", () => {
  const route = read("src/app/api/chat/route.ts");
  assert.match(route, /const MAX_CONCURRENT_ANSWERS_PER_USER = 2;/);
  const post = route.slice(route.indexOf("export async function POST(request: Request) {"));
  assert.ok(post.indexOf("claimAnswerSlot(user.id)") < post.indexOf("withAiTokenUsageTracking"), "claimed before any work");
  assert.match(post, /status: 429/);
  assert.match(route, /releaseSlot\(\);\n\s+try \{\n\s+controller\.close\(\);/, "the stream releases its slot when it ends");
  assert.match(post, /if \(!streaming\) releaseSlot\(\);/, "the JSON path releases in finally");
});

test("a new password needs ten characters; an existing one still signs in", () => {
  const panel = read("src/components/auth/AuthPanel.tsx");
  assert.match(panel, /minLength=\{passwordMode === "signup" \? MIN_NEW_PASSWORD_LENGTH : undefined\}/);
  const errors = read("src/lib/auth/auth-errors.ts");
  assert.match(errors, /export const MIN_NEW_PASSWORD_LENGTH = 10;/);
  assert.match(errors, /"auth\/password-does-not-meet-requirements"/);
});

test("refused and abandoned uploads do not stay in the bucket", () => {
  // Which runs the sweep fails is called in guards-behaviour.test.ts.
  const finalize = read("src/app/api/admin/import/finalize/route.ts");
  const refusals = finalize.slice(finalize.indexOf("const maxUploadBytes"), finalize.indexOf("queueableUploadedItems.push(item);"));
  assert.equal((refusals.match(/await deleteGcsObject\(storagePath\)/g) ?? []).length, 2, "an oversized or non-PDF file is deleted");

  const prepare = read("src/app/api/admin/import/prepare/route.ts");
  assert.ok(
    prepare.indexOf("failAbandonedUploads(user!.id)") < prepare.indexOf("createUploadBatch({"),
    "the sweep runs before the quota is counted"
  );
  const gcs = read("src/lib/gcs-signed-urls.ts");
  assert.match(gcs, /matchGlob: `pending\/\*\*\/\$\{runId\}\/\*\*`/);
  assert.match(gcs, /\[0-9a-f\]\{8\}-/, "the run id is checked before it goes into a glob");
});

test("background jobs are queued with a Google-signed token, not the shared secret", () => {
  // The callbacks' check runs, with signed tokens, in task-callers.test.ts.
  // They used to accept the shared worker secret, carried in every task's
  // headers and held by several services.
  for (const creator of [
    "src/lib/repository-chat-jobs.ts",
    "src/lib/semantic-map-jobs.ts",
    "src/lib/project-reclassification-jobs.ts",
  ]) {
    const src = read(creator);
    assert.match(src, /const oidcToken = await taskOidcToken\(\);/, `${creator} mints a token`);
    assert.match(src, /\n\s+oidcToken,\n/, `${creator} attaches it to the task`);
    assert.doesNotMatch(src, /"x-worker-secret"/, `${creator} no longer puts the secret in the task`);
  }
  assert.match(read("package.json"), /"google-auth-library": "\^10\.9\.0"/, "a direct dependency, not a transitive one");
});

test("the Drive Picker opens in view, above the upload window", () => {
  // Google places the Picker from the page's scroll position; inside the
  // scrolling upload modal it opened above the screen.
  const css = read("src/app/globals.css");
  const dialog = css.slice(css.indexOf(".picker-dialog {"));
  assert.match(dialog, /position: fixed !important;/);
  assert.match(dialog, /transform: translate\(-50%, -50%\) !important;/);
  assert.match(css, /\.picker-dialog-bg \{\s*position: fixed !important;/);
});

test("a stuck Drive Picker can always be closed, and the reader is told why", () => {
  // With Google's cookies blocked in the page, the Picker asks to sign in
  // again and a file chosen in its window never arrives; its own close control
  // may not show, which left the dialog with no way out.
  const picker = read("src/lib/google-drive-picker.ts");
  assert.match(picker, /function addPageCloseControl\(onClose: \(\) => void\)/);
  assert.match(picker, /event\.key !== "Escape"/);
  assert.match(picker, /window\.addEventListener\("keydown", onKey, true\)/, "caught before the upload window's handler");
  assert.match(picker, /event\.stopPropagation\(\);\s+onClose\(\);/, "and not passed on to it");
  assert.match(picker, /removeCloseControl = addPageCloseControl\(\(\) => finish\(\(\) => reject\(new DrivePickerCancelled\(true\)\)\)\);/);
  assert.match(picker, /pickerHandle\?\.dispose\?\.\(\)/, "the Picker is torn down when it closes");
  const modal = read("src/components/workspace/AnalyzeFlowModal.tsx");
  assert.match(modal, /if \(driveError\.closedByPage\)/);
  assert.match(modal, /Allow third-party cookies for this site in your browser's settings/);
  assert.match(read("src/app/globals.css"), /\.drive-picker-close \{[\s\S]*?z-index: 2147483002;/);
});

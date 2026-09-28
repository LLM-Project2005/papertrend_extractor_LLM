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
  assert.match(chat, /<Link href=\{safeCitationHref\(source\.href\)\}/, "research sources are checked");
  assert.doesNotMatch(chat, /<Link href=\{source\.href\}/);
});

test("the chart planner's prompt context is bounded", () => {
  // It passed through unchecked, so one request could put megabytes of text
  // into a paid model call outside the token budget.
  const route = read("src/app/api/visualization-plan/route.ts");
  assert.doesNotMatch(route, /\.passthrough\(\)/);
  assert.match(route, /goal: z\.string\(\)\.max\(2_000\)\.optional\(\)/);
  assert.match(route, /workspaceName: z\.string\(\)\.max\(120\)\.optional\(\)/);
});

test("the daily usage limit holds under parallel requests and fails closed", () => {
  const guards = read("src/lib/security-guards.ts");
  const fn = guards.slice(guards.indexOf("export async function assertAndRecordAiUsage"));
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/, "count and insert are serialised");
  assert.ok(fn.indexOf("pg_advisory_xact_lock") < fn.indexOf("SELECT count(*)"), "the lock comes before the count");
  assert.match(fn, /throw new GuardError\("Usage could not be checked just now\. Try again in a moment\.", 503\)/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("const supabase")), /allowing request/);
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

test("a paper is analysed again at most three times a day", () => {
  const repo = read("src/lib/cloudsql/analysis-job-repository.ts");
  assert.match(repo, /export const MAX_REANALYSES_PER_PAPER_PER_DAY = 3;/);
  assert.match(repo, /'reanalysis_day_count', CASE WHEN/);
  assert.match(repo, /AND NOT \(COALESCE\(ir\.input_payload->>'reanalysis_day', ''\)/);
  assert.match(repo, /today, MAX_REANALYSES_PER_PAPER_PER_DAY\]/, "the cap is a parameter, not SQL text");
});

test("a new password needs ten characters; an existing one still signs in", () => {
  const panel = read("src/components/auth/AuthPanel.tsx");
  assert.match(panel, /minLength=\{passwordMode === "signup" \? MIN_NEW_PASSWORD_LENGTH : undefined\}/);
  const errors = read("src/lib/auth/auth-errors.ts");
  assert.match(errors, /export const MIN_NEW_PASSWORD_LENGTH = 10;/);
  assert.match(errors, /"auth\/password-does-not-meet-requirements"/);
});

test("refused and abandoned uploads do not stay in the bucket", () => {
  const finalize = read("src/app/api/admin/import/finalize/route.ts");
  const refusals = finalize.slice(finalize.indexOf("const maxUploadBytes"), finalize.indexOf("queueableUploadedItems.push(item);"));
  assert.equal((refusals.match(/await deleteGcsObject\(storagePath\)/g) ?? []).length, 2, "an oversized or non-PDF file is deleted");

  const repo = read("src/lib/cloudsql/ingestion-repository.ts");
  const sweep = repo.slice(repo.indexOf("async failAbandonedUploads"), repo.indexOf("async loadOwnedBatch"));
  assert.match(sweep, /WHERE owner_user_id = \$1 AND source_type = 'upload'/, "only the caller's own uploads");
  assert.match(sweep, /status = 'processing' AND source_path IS NULL/, "only uploads never finalized");
  assert.match(sweep, /make_interval\(mins => \$2::int\)/);

  const prepare = read("src/app/api/admin/import/prepare/route.ts");
  assert.ok(
    prepare.indexOf("failAbandonedUploads(user!.id)") < prepare.indexOf("createUploadBatch({"),
    "the sweep runs before the quota is counted"
  );
  const gcs = read("src/lib/gcs-signed-urls.ts");
  assert.match(gcs, /matchGlob: `pending\/\*\*\/\$\{runId\}\/\*\*`/);
  assert.match(gcs, /\[0-9a-f\]\{8\}-/, "the run id is checked before it goes into a glob");
});

test("background-job callbacks accept only a Google-signed token for this service", () => {
  // They used to accept the shared worker secret, carried in every task's
  // headers and held by several services.
  for (const route of [
    "src/app/api/chat/jobs/process/route.ts",
    "src/app/api/workspace/semantic-map/jobs/process/route.ts",
    "src/app/api/workspace/projects/reclassify/process/route.ts",
  ]) {
    const src = read(route);
    assert.match(src, /if \(!\(await isVerifiedTaskCaller\(request\)\)\)/, `${route} verifies the token`);
    assert.doesNotMatch(src, /x-worker-secret/, `${route} no longer reads the secret`);
  }
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
  const oidc = read("src/lib/cloud-tasks-oidc.ts");
  assert.match(oidc, /verifier\.verifyIdToken\(\{ idToken: match\[1\], audience \}\)/, "signature and audience are checked");
  assert.match(oidc, /payload\.email_verified === true/);
  assert.match(oidc, /payload\.email\?\.toLowerCase\(\) === expectedEmail\.toLowerCase\(\)/, "only this service's own account");
  assert.match(read("package.json"), /"google-auth-library": "\^10\.9\.0"/, "a direct dependency, not a transitive one");
});

test("every response carries an enforced Content-Security-Policy", () => {
  const config = read("next.config.mjs");
  assert.match(config, /const CSP_HEADER = "Content-Security-Policy";/, "enforced, not report-only");
  assert.match(config, /\{ key: CSP_HEADER, value: contentSecurityPolicy \}/);
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(config.includes(`"${directive}"`), `missing ${directive}`);
  }
  assert.match(config, /\["connect-src 'self'", directApiOrigin,/, "data may go only to named hosts");
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
  assert.match(picker, /event\.key === "Escape"/);
  assert.match(picker, /removeCloseControl = addPageCloseControl\(\(\) => finish\(\(\) => reject\(new DrivePickerCancelled\(true\)\)\)\);/);
  assert.match(picker, /pickerHandle\?\.dispose\?\.\(\)/, "the Picker is torn down when it closes");
  const modal = read("src/components/workspace/AnalyzeFlowModal.tsx");
  assert.match(modal, /if \(driveError\.closedByPage\)/);
  assert.match(modal, /Allow third-party cookies for \[\*\.\]google\.com/);
  assert.match(read("src/app/globals.css"), /\.drive-picker-close \{[\s\S]*?z-index: 2147483002;/);
});

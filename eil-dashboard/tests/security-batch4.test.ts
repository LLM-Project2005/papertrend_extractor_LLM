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

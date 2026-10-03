/*
 * Rules over the whole source tree that no single call can show: what a
 * browser bundle may carry, which HTML sinks exist, and that every query keeps
 * values out of its SQL text. Each is a guard for code not yet written, so it
 * reads the source. What can be run is run elsewhere (docs/32, long-term
 * health): every route is called as a stranger in
 * boot-security-behaviour-probe.test.ts, where the list of public routes now
 * lives; hostile values, uploads, a paper's text and the dashboard's payload
 * in boot-security-behaviour-routes.test.ts; rate limits and invite codes in
 * boot-security-behaviour-auth.test.ts; secret comparison, cross-origin
 * access, redirects and PDF checks in security-behaviour.test.ts; task tokens
 * in task-callers.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function walk(dir: string, match: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    const full = join(ROOT, rel);
    if (statSync(full).isDirectory()) out.push(...walk(rel, match));
    else if (match(rel)) out.push(rel);
  }
  return out;
}

const API_ROUTES = walk("src/app/api", (p) => p.endsWith("/route.ts"));
const SOURCE_FILES = [
  ...walk("src", (p) => p.endsWith(".ts") || p.endsWith(".tsx")),
];

test("the retired server-side Drive OAuth flow stays gone", () => {
  // Its OAuth state was not tied to the browser that started it, its return
  // address was not checked, and it kept Drive refresh tokens on the server.
  // The Picker replaced it: the browser holds a short drive.file token.
  for (const route of ["connect", "callback", "files", "queue"]) {
    assert.equal(
      API_ROUTES.some((r) => r.replace(/\\/g, "/") === `src/app/api/integrations/google-drive/${route}/route.ts`),
      false,
      `google-drive/${route} is back`
    );
  }
});

test("the research cron refuses a wrong or missing secret", async () => {
  const { GET } = await import("../src/app/api/cron/process-research-queue/route");
  const call = (authorization: string) => GET(new Request("https://papertrend.test/api/cron/process-research-queue", { headers: { authorization } }));
  const configured = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "research-cron-secret";
  try {
    for (const authorization of ["", "Bearer research-cron-secreT", "Bearer research-cron", "research-cron-secret", "Bearer "]) {
      assert.equal((await call(authorization)).status, 401, JSON.stringify(authorization));
    }
    delete process.env.CRON_SECRET;
    assert.equal((await call("Bearer anything")).status, 500, "an unconfigured secret fails closed");
  } finally {
    if (configured === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = configured;
  }
});

test("the research cron compares its secret in constant time", () => {
  // Kept as text: how long a comparison takes cannot be measured reliably in a
  // test. The comparison itself is run in security-behaviour.test.ts.
  const src = read("src/app/api/cron/process-research-queue/route.ts");
  assert.match(src, /isValidBearerSecret\(authHeader, expectedCronSecret\)/);
  assert.equal(/authHeader !== `Bearer \$\{/.test(src), false, "a plain string compare short-circuits on the first differing byte");
});

test("SQL is parameterized, never concatenated from values", () => {
  // Kept as text: a rule for every query, including ones not yet written.
  // Hostile values sent through the routes that build SQL from fragments
  // (assignments, owner, organization and project filters) are run in
  // boot-security-behaviour-routes.test.ts.
  //
  // Interpolation into a query string is allowed only for fragments the code
  // itself wrote - a joined list of literal conditions, or a placeholder index
  // like $${values.length}. Anything else is a value reaching the parser.
  //
  // Each entry below was read before being allowed. They share one shape: the
  // fragment is assembled from string literals in the source, every value goes
  // into the parameter array, and the statement is scoped by owner_user_id.
  // `assignments` builds an UPDATE SET clause that way - the column names are
  // literals, the values are $n placeholders.
  //
  // A new name appearing here is the point of this test: it has to be read.
  const allowed = new RegExp(
    [
      /^\$\$\{values\.length[^}]*\}$/,
      /^\$\{conditions\.join\(" AND "\)\}$/,
      /^\$\{assignments\.join\(", "\)\}$/,
      /^\$\{condition\}$/,
      /^\$\{filter\}$/,
      /^\$\{runFilter\}$/,
      /^\$\{scope\}$/,
      /^\$\{organizationFilter\}$/,
      /^\$\{projectFilter\}$/,
      // The shared "usable analysis" rule, for a literal table alias (docs/32, 2.4).
      /^\$\{usableAnalysisSql\("[a-z]+"\)\}$/,
      // paper-copy.ts (docs/32, 2.5): the table comes from the PAPER_TABLES
      // constant or a literal list, the key is "id" or "paper_id", column names
      // come from information_schema through ident(), which admits only
      // [a-z_][a-z0-9_]*, and the values are column references, placeholders or
      // now(). The paper id helper takes a literal placeholder.
      /^\$\{table\}$/,
      /^\$\{key\}$/,
      /^\$\{copied\.map\(\(column\) => ident\(column\.column_name\)\)\.join\(", "\)\}$/,
      /^\$\{values\.join\(", "\)\}$/,
      /^\$\{paperIdFromRunSql\("\$\d"\)\}$/,
      // access-request-repository.ts (docs/32, 4.1): a constant list of literal
      // column names; every value is a placeholder.
      /^\$\{SUMMARY_COLUMNS\}$/,
    ]
      .map((r) => r.source)
      .join("|")
  );
  const offenders: string[] = [];
  for (const file of SOURCE_FILES.filter((f) => f.includes("/lib/"))) {
    const src = read(file);
    for (const match of src.matchAll(/client\.query<?[^(]*\(\s*`([\s\S]*?)`/g)) {
      const sql = match[1];
      for (const interpolation of sql.matchAll(/\$?\$\{[^}]*\}/g)) {
        if (!allowed.test(interpolation[0])) {
          offenders.push(`${file}: ${interpolation[0]}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], "unrecognised interpolation inside a SQL string");
});

// Kept as text, this test and the next: what a browser bundle may carry is the build's shape.
test("server-only modules cannot be pulled into a browser bundle", () => {
  const serverOnly = /@\/lib\/supabase-admin|@\/lib\/server-env|@\/lib\/cloudsql\/client|@\/lib\/admin-auth|@\/lib\/security-guards/;
  const leaks: string[] = [];
  for (const file of SOURCE_FILES) {
    const src = read(file);
    if (!/^"use client";/.test(src)) continue;
    if (serverOnly.test(src)) leaks.push(file);
  }
  assert.deepEqual(leaks, [], "a client component imports a module holding service credentials");
});

test("no server secret is referenced from a client component", () => {
  const leaks: string[] = [];
  for (const file of SOURCE_FILES) {
    const src = read(file);
    if (!/^"use client";/.test(src)) continue;
    for (const match of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!match[1].startsWith("NEXT_PUBLIC_")) leaks.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(leaks, []);
});

// Kept as text: which script-execution sinks exist anywhere in the source.
test("the only raw HTML injected is a static module constant", () => {
  const sinks: string[] = [];
  for (const file of SOURCE_FILES) {
    const src = read(file);
    for (const match of src.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]+)\}\}/g)) {
      if (match[1].trim() !== "themeScript") sinks.push(`${file}: ${match[1].trim()}`);
    }
    for (const forbidden of [/\.innerHTML\s*=/, /document\.write\(/, /\beval\(/, /new Function\(/]) {
      assert.equal(forbidden.test(src), false, `${file} uses a script-execution sink`);
    }
  }
  assert.deepEqual(sinks, [], "only the pre-paint theme constant may be injected as HTML");
});

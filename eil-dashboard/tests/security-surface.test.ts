import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

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

/**
 * Routes that are reachable without a signed-in user, each for a stated reason.
 * Adding a route here is a deliberate decision, which is the point: the test
 * below fails for anything new that is neither authenticated nor listed.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  "src/app/api/health/route.ts": "liveness probe, returns no data",
  "src/app/api/auth/password-login/route.ts": "you cannot be signed in to sign in",
  "src/app/api/auth/password-signup/route.ts": "account creation",
  "src/app/api/auth/password-reset/route.ts": "reset requested while locked out",
  "src/app/api/auth/firebase/link/route.ts": "links a Firebase identity to an owner record",
  "src/app/api/integrations/google-drive/callback/route.ts": "OAuth redirect from Google",
};

/** A route that verifies a machine caller rather than a person. */
const MACHINE_AUTH = /isRepositoryJobSecretValid|isValidBearerSecret|isAuthorizedAdminRequest|getCronSecret/;
/** A route that verifies a signed-in person. */
const USER_AUTH = /getAuthenticatedUserFromRequest|getAuthenticatedIdentityFromRequest|isAuthorizedUserOrAdminRequest|isAuthorizedAdminRequest/;

test("every API route authenticates somebody, or says why it does not", () => {
  const unguarded: string[] = [];
  for (const route of API_ROUTES) {
    const normalized = route.replace(/\\/g, "/");
    if (PUBLIC_ROUTES[normalized]) continue;
    const src = read(route);
    if (USER_AUTH.test(src) || MACHINE_AUTH.test(src)) continue;
    unguarded.push(normalized);
  }
  assert.deepEqual(unguarded, [], "these routes verify nobody and are not on the public list");
});

test("the public list has not grown stale", () => {
  for (const route of Object.keys(PUBLIC_ROUTES)) {
    assert.ok(
      API_ROUTES.some((r) => r.replace(/\\/g, "/") === route),
      `${route} is on the public list but no longer exists`
    );
  }
});

test("the admin secret is never read from a URL", () => {
  // A query string is written to Cloud Run request logs, kept in browser
  // history, and forwarded in the Referer header to anything the page links to.
  // Every caller in this codebase sends the header, so the query form was an
  // exposure route with no consumer.
  const auth = read("src/lib/admin-auth.ts");
  assert.equal(/searchParams\.get\("admin_secret"\)/.test(auth), false);
  for (const file of SOURCE_FILES) {
    const src = read(file);
    assert.equal(
      /searchParams\.get\(["']admin_secret["']\)/.test(src),
      false,
      `${file} reads the admin secret from the URL`
    );
  }
});

test("secrets are compared in constant time and fail closed when unset", () => {
  const auth = read("src/lib/admin-auth.ts");
  assert.match(auth, /timingSafeEqual/);
  // safeEqual must length-check first: timingSafeEqual throws on a length
  // mismatch, so a missing check turns a wrong guess into a 500 that leaks the
  // expected length.
  assert.match(auth, /if \(leftBuffer\.length !== rightBuffer\.length\) \{\s*\n\s*return false;/);
  assert.match(auth, /if \(!expectedSecret\) return false;/);

  const jobs = read("src/lib/repository-chat-jobs.ts");
  assert.match(jobs, /if \(!expected \|\| !value\) return false;/);
  assert.match(jobs, /left\.length === right\.length && timingSafeEqual\(left, right\)/);

  for (const cron of [
    "src/app/api/cron/process-queue/route.ts",
    "src/app/api/cron/process-research-queue/route.ts",
  ]) {
    const src = read(cron);
    assert.match(src, /isValidBearerSecret\(authHeader, expectedCronSecret\)/);
    assert.equal(
      /authHeader !== `Bearer \$\{/.test(src),
      false,
      "a plain string compare short-circuits on the first differing byte"
    );
  }
});

test("authorization never comes from the request body", () => {
  // The handoff is explicit: an owner UUID supplied by a browser is not
  // evidence of anything. Ownership must be derived from the verified token.
  for (const route of API_ROUTES) {
    const src = read(route);
    for (const pattern of [
      /body\.ownerUserId/,
      /body\.owner_user_id/,
      /searchParams\.get\(["']ownerUserId["']\)/,
      /searchParams\.get\(["']owner_user_id["']\)/,
    ]) {
      assert.equal(
        pattern.test(src),
        false,
        `${route} takes an owner identifier from the caller`
      );
    }
  }
});

test("SQL is parameterized, never concatenated from values", () => {
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

test("cross-origin access is an allowlist, never a wildcard", () => {
  const cors = read("src/lib/chat-cors.ts");
  assert.equal(/"Access-Control-Allow-Origin": "\*"/.test(cors), false);
  assert.match(cors, /if \(!allowed\.includes\(normalized\)\) return \{\};/);
  assert.match(cors, /Vary: "Origin"/, "a varying origin must not be cached across origins");
  assert.equal(
    /Access-Control-Allow-Credentials/.test(cors),
    false,
    "bearer-token auth needs no credentials, and allowing them widens the blast radius"
  );
});

test("a redirect target cannot be pointed off-site", () => {
  const guards = read("src/lib/security-guards.ts");
  const fn = guards.slice(guards.indexOf("export function validateSafeReturnTo"));
  assert.match(fn, /raw\.startsWith\("\/\/"\)/, "a protocol-relative URL leaves the site");
  assert.match(fn, /url\.origin === new URL\(configured\)\.origin/);
  assert.match(fn, /return raw\.startsWith\("\/"\) \? raw : fallback;/);
});

test("uploads are checked by content, not only by name", () => {
  const safety = read("src/lib/upload-safety.ts");
  assert.match(safety, /subarray\(0, 5\)\.toString\("ascii"\) === "%PDF-"/);
  assert.match(safety, /replace\(\/\[\^a-zA-Z0-9\._-\]\+\/g, "-"\)/, "the stored name is stripped to a safe set");
  assert.match(read("src/app/api/admin/import/route.ts"), /if \(!hasPdfMagic\(fileBuffer\)\)/);
});

test("rate-limit subjects are stored hashed", () => {
  const guards = read("src/lib/security-guards.ts");
  assert.match(guards, /createHash\("sha256"\)/);
  assert.match(guards, /const ipHash = hashSubject\(getClientIp\(request\)\)/);
  assert.match(guards, /const subjectHash = hashSubject\(`\$\{email\}:\$\{ipHash\}`\)/);
});

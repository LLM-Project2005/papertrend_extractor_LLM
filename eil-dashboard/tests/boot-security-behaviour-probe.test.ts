/*
 * Every API route, probed without a session (docs/32, long-term health): each
 * handler is called as a stranger would call it - no token or a forged one,
 * the shared secrets in the address, an existing owner's id in the body and
 * the address - and must refuse. This replaces security-surface's text scan
 * for an auth call in each route file. Routes run as written against PGlite
 * (tests/support/route-harness.ts); new routes are found by walking the tree.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { routeHarness } from "./support/route-harness";
import { resolveServerOnlyAsServer } from "./support/stub-bootsec-server-only";

resolveServerOnlyAsServer();

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SECRET = "shared-secret-for-route-probes";
const CRON = "cron-secret-for-route-probes";
const OWNER = "00000000-0000-4000-8000-00000000000a";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith("/route.ts")) out.push(rel);
  }
  return out;
}

const API_ROUTES = walk("src/app/api");

/**
 * Routes that are reachable without a signed-in user, each for a stated reason.
 * Adding a route here is a deliberate decision, which is the point: the probe
 * below fails for anything new that answers a stranger and is not listed.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  "src/app/api/health/route.ts": "liveness probe, returns no data",
  "src/app/api/auth/password-login/route.ts": "you cannot be signed in to sign in",
  "src/app/api/auth/password-signup/route.ts": "account creation",
  "src/app/api/auth/password-reset/route.ts": "reset requested while locked out",
  "src/app/api/auth/firebase/link/route.ts": "links a Firebase identity to an owner record",
  "src/app/api/access-requests/route.ts": "someone without an account asks for an invite; rate limited, same reply for every request",
};

/** Answers a stranger anyway; see the skipped BUG test in boot-security-behaviour-routes.test.ts. */
/** Routes that answer a stranger with something other than a refusal, and why. None now. */
const KNOWN_OPEN: Record<string, string> = {};

/** What each handler of one route answers a stranger, by method and token. */
async function probe(route: string, query: string): Promise<Array<{ call: string; status: number }>> {
  const handlers = await import(pathToFileURL(join(ROOT, route)).href);
  const uuid = "00000000-0000-4000-8000-000000000001";
  const routeParams = Object.fromEntries([...route.matchAll(/\[([a-zA-Z]+)\]/g)].map((match) => [match[1], uuid]));
  const path = route.replace("src/app", "").replace("/route.ts", "").replace(/\[[a-zA-Z]+\]/g, uuid);
  const answers: Array<{ call: string; status: number }> = [];
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    if (typeof handlers[method] !== "function") continue;
    for (const authorization of [undefined, "Bearer forged-token", `Bearer ${SECRET}`]) {
      const request = new Request(`https://papertrend.test${path}${query}`, {
        method,
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({ ownerUserId: OWNER, owner_user_id: OWNER, userId: OWNER }),
      });
      const response: Response = await handlers[method](request, { params: Promise.resolve(routeParams) });
      answers.push({ call: `${method} ${route} (${authorization ?? "no token"})`, status: response.status });
    }
  }
  return answers;
}

test("every API route refuses a stranger, whatever secret or owner the request names", async () => {
  const harness = await routeHarness({ ADMIN_IMPORT_SECRET: SECRET, CRON_SECRET: CRON, WORKER_SECRET: SECRET });
  await harness.signIn(OWNER);
  const query = `?admin_secret=${SECRET}&secret=${CRON}&token=${SECRET}&ownerUserId=${OWNER}&owner_user_id=${OWNER}`;
  const answers: Array<{ call: string; status: number }> = [];
  // A forged token is logged as a failed check; that is expected here.
  const quiet = mock.method(console, "error", () => undefined);
  try {
    for (const route of API_ROUTES) {
      if (!PUBLIC_ROUTES[route] && !KNOWN_OPEN[route]) answers.push(...(await probe(route, query)));
    }
  } finally {
    quiet.mock.restore();
  }
  assert.ok(answers.length > 150, `only ${answers.length} calls`);
  // 410: a retired route, which does nothing for anyone.
  const answered = answers.filter((answer) => ![401, 403, 410].includes(answer.status)).map((answer) => `${answer.call}: ${answer.status}`);
  assert.deepEqual(answered, [], "these answered a stranger and are not on the public list");
});

test("the public list, and the known exception, name routes that still exist", () => {
  for (const route of [...Object.keys(PUBLIC_ROUTES), ...Object.keys(KNOWN_OPEN)]) {
    assert.ok(API_ROUTES.includes(route), `${route} is listed but no longer exists`);
  }
});

test("the admin secret is accepted from its header only, never from the address", async () => {
  // A query string is written to Cloud Run request logs, kept in browser
  // history, and forwarded in the Referer header to anything the page links to.
  await routeHarness({ ADMIN_IMPORT_SECRET: SECRET });
  const { isAuthorizedAdminRequest, isAuthorizedUserOrAdminRequest } = await import("../src/lib/admin-auth");
  const inAddress = new Request(`https://papertrend.test/api/admin/import?admin_secret=${SECRET}`);
  const inHeader = new Request("https://papertrend.test/api/admin/import", { headers: { "x-admin-secret": SECRET } });
  const wrong = new Request("https://papertrend.test/api/admin/import", { headers: { "x-admin-secret": `${SECRET}x` } });
  for (const check of [isAuthorizedAdminRequest, isAuthorizedUserOrAdminRequest]) {
    assert.equal(await check(inAddress), false, `${check.name}: from the address`);
    assert.equal(await check(wrong), false, `${check.name}: a wrong secret`);
    assert.equal(await check(inHeader), true, `${check.name}: from the header`);
  }
});

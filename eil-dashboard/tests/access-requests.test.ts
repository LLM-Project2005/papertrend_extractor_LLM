/*
 * Request access (docs/32, 4.1): the form's parsing, its rate limit, and the
 * requests table run for real in PGlite, as the application's role, with the
 * repository's own transaction bodies.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parseAccessRequest } from "../src/lib/access-requests";
import {
  AccessRequestStateError,
  declineAccessRequestIn,
  deleteAccessRequestIn,
  inviteFromAccessRequestIn,
  listAccessRequestsIn,
  submitAccessRequestIn,
} from "../src/lib/cloudsql/access-request-repository";
import { hashInviteCode, normalizeInviteCode } from "../src/lib/invite-codes";
import { ledgerProblems, mustRecordItself } from "../src/lib/migration-ledger";
import { assertAccessRequestRateLimit, GuardError, resetLoginRateLimitMemory } from "../src/lib/security-guards";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ADMIN = "00000000-0000-0000-0000-0000000000ad";

const valid = {
  name: "  Somchai   Jaidee ",
  email: " Somchai@Example.EDU ",
  affiliation: "Chulalongkorn University,\nFaculty of Arts",
  intendedUse: "A literature review for my thesis on EFL writing feedback, about 40 papers.",
  website: "",
};

test("a request is read with its text tidied; a bad one is refused; a filled hidden field is a bot", () => {
  const parsed = parseAccessRequest(valid);
  assert.equal(parsed.kind, "request");
  if (parsed.kind !== "request") return;
  assert.deepEqual(parsed.request, {
    name: "Somchai Jaidee",
    email: "somchai@example.edu",
    affiliation: "Chulalongkorn University, Faculty of Arts",
    intendedUse: valid.intendedUse,
  });
  assert.equal(parseAccessRequest({ ...valid, email: "not-an-email" }).kind, "invalid");
  assert.equal(parseAccessRequest({ ...valid, intendedUse: "short" }).kind, "invalid");
  assert.equal(parseAccessRequest({ ...valid, name: "   " }).kind, "invalid");
  assert.equal(parseAccessRequest({ ...valid, intendedUse: "x".repeat(1001) }).kind, "invalid");
  assert.equal(parseAccessRequest(null).kind, "invalid");
  assert.equal(parseAccessRequest({ ...valid, website: "https://spam.example" }).kind, "bot");
});

test("one email may ask 3 times a day; the 4th is refused (the in-memory count, as when the store is down)", async () => {
  resetLoginRateLimitMemory();
  const request = () => new Request("https://papertrend.test/api/access-requests", { headers: { "x-forwarded-for": "203.0.113.9" } });
  for (let i = 0; i < 3; i += 1) await assertAccessRequestRateLimit(request(), "a@example.edu");
  await assert.rejects(assertAccessRequestRateLimit(request(), "A@example.edu "), (error: unknown) => {
    assert.ok(error instanceof GuardError);
    assert.equal(error.status, 429);
    return true;
  });
  // Another email from the same address still gets through, until the address's own limit.
  await assertAccessRequestRateLimit(request(), "b@example.edu");
  resetLoginRateLimitMemory();
});

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE papertrend_app NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE public.user_profiles (
      id UUID PRIMARY KEY, email TEXT UNIQUE, full_name TEXT, avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'member', workspace_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
    INSERT INTO public.user_profiles (id, email, role) VALUES ('${ADMIN}', 'admin@example.edu', 'admin');
    GRANT USAGE ON SCHEMA public TO papertrend_app;
  `);
  for (const file of ["20260929_invite_codes.sql", "20261002_schema_migrations.sql", "20261002_access_requests.sql"]) {
    await db.exec(read(`cloudsql/${file}`));
  }
  // Everything below runs as the application does: no superuser, only the grants the migrations give.
  await db.exec("SET ROLE papertrend_app");
  const client = { query: (text: string, params?: unknown[]) => db.query(text, params) } as never;
  const inTransaction = async <T,>(work: () => Promise<T>): Promise<T> => {
    await db.query("BEGIN");
    try {
      const result = await work();
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  };
  return { db, client, inTransaction };
}

function request(email = "somchai@example.edu", use = valid.intendedUse) {
  return { name: "Somchai Jaidee", email, affiliation: "Chulalongkorn University", intendedUse: use };
}

test("asking again while waiting updates the one request; after an answer, a new one is opened", async () => {
  const { db, client, inTransaction } = await database();
  await inTransaction(() => submitAccessRequestIn(client, request()));
  await inTransaction(() => submitAccessRequestIn(client, request("somchai@example.edu", "A second, longer description of the review.")));
  let rows = await inTransaction(() => listAccessRequestsIn(client));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].intendedUse, "A second, longer description of the review.");
  assert.equal(rows[0].status, "pending");

  await inTransaction(() => declineAccessRequestIn(client, { requestId: rows[0].id, adminId: ADMIN }));
  await inTransaction(() => submitAccessRequestIn(client, request()));
  rows = await inTransaction(() => listAccessRequestsIn(client));
  assert.deepEqual(rows.map((row) => row.status), ["pending", "declined"], "waiting ones first");
  await db.close();
});

test("inviting makes a one-use code bound to the request's email, once; the code is never stored", async () => {
  const { db, client, inTransaction } = await database();
  await inTransaction(() => submitAccessRequestIn(client, request()));
  const [pending] = await inTransaction(() => listAccessRequestsIn(client));
  const { code, invite, request: answered } = await inTransaction(() =>
    inviteFromAccessRequestIn(client, { requestId: pending.id, adminId: ADMIN })
  );
  assert.equal(invite.boundEmail, "somchai@example.edu");
  assert.equal(invite.maxUses, 1);
  assert.equal(answered.status, "invited");
  assert.equal(answered.inviteStatus, "active");
  const stored = await db.query<{ code_hash: string; label: string; days: number }>(
    `SELECT code_hash, label, round(extract(epoch FROM expires_at - created_at) / 86400)::int AS days FROM public.invite_codes`
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].code_hash, hashInviteCode(normalizeInviteCode(code)!), "only the hash is kept");
  assert.equal(stored.rows[0].label, "Access request: Somchai Jaidee");
  assert.equal(stored.rows[0].days, 14);

  await assert.rejects(
    inTransaction(() => inviteFromAccessRequestIn(client, { requestId: pending.id, adminId: ADMIN })),
    (error: unknown) => error instanceof AccessRequestStateError && error.status === 409
  );
  assert.equal((await db.query("SELECT 1 FROM public.invite_codes")).rows.length, 1, "no second code");
  await assert.rejects(
    inTransaction(() => declineAccessRequestIn(client, { requestId: "00000000-0000-0000-0000-000000000999", adminId: ADMIN })),
    (error: unknown) => error instanceof AccessRequestStateError && error.status === 404
  );
  await db.close();
});

test("requests older than 180 days are deleted, and one can be deleted at once", async () => {
  const { db, client, inTransaction } = await database();
  await inTransaction(() => submitAccessRequestIn(client, request("old@example.edu")));
  await inTransaction(() => submitAccessRequestIn(client, request("new@example.edu")));
  await db.query(`UPDATE public.access_requests SET created_at = now() - interval '181 days' WHERE email = 'old@example.edu'`);
  const rows = await inTransaction(() => listAccessRequestsIn(client));
  assert.deepEqual(rows.map((row) => row.email), ["new@example.edu"]);
  assert.equal(await inTransaction(() => deleteAccessRequestIn(client, rows[0].id)), true);
  assert.equal((await inTransaction(() => listAccessRequestsIn(client))).length, 0);
  await db.close();
});

test("the ledger records the migrations, the new one included", async () => {
  const { db } = await database();
  const names = (await db.query<{ name: string }>("SELECT name FROM public.schema_migrations")).rows.map((row) => row.name);
  assert.ok(names.includes("20261002_access_requests.sql"));
  assert.ok(names.includes("20260929_invite_codes.sql"));
  assert.ok(!names.includes("phase3_owner_rls.sql"), "the preparation script was never applied");
  await db.close();
});

test("every migration from the ledger on records itself inside its transaction", () => {
  const files = readdirSync(new URL("../cloudsql/", import.meta.url)).filter((name) => name.endsWith(".sql"));
  const checked = files.filter(mustRecordItself);
  assert.ok(checked.length >= 2);
  for (const name of checked) assert.deepEqual(ledgerProblems(name, read(`cloudsql/${name}`)), [], name);
  // And the rule catches a file that does not.
  assert.deepEqual(ledgerProblems("20991231_x.sql", "BEGIN;\nCREATE TABLE x ();\nCOMMIT;\n"), [
    "does not record its own name in public.schema_migrations",
  ]);
  assert.deepEqual(
    ledgerProblems("20991231_x.sql", "BEGIN;\nCOMMIT;\nINSERT INTO public.schema_migrations (name) VALUES ('20991231_x.sql');\n"),
    ["records itself after COMMIT"]
  );
  assert.deepEqual(ledgerProblems("20260929_invite_codes.sql", "anything"), [], "earlier files are recorded by the ledger");
});

test("the public site says it is invite-only and links to the form; the code screen does too", () => {
  for (const path of ["src/app/page.tsx", "src/components/auth/AuthPanel.tsx", "src/components/marketing/MarketingLayout.tsx"]) {
    assert.match(read(path), /href[=:] ?"\/request-access"/, path);
  }
  const panel = read("src/components/auth/AuthPanel.tsx");
  const inviteScreen = panel.slice(panel.indexOf("Enter your invite code"), panel.indexOf("Signed in with the wrong account?"));
  assert.match(inviteScreen, /No code yet\?/);
  assert.match(read("src/components/marketing/marketing-content.ts"), /invite-only during its beta/);
  assert.match(read("src/lib/legal-content.ts"), /Access requests: 180 days/);
});

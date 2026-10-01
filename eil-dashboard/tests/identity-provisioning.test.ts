/*
 * Account provisioning and linking, run for real: PGlite (Postgres in
 * WebAssembly) with the identity-mapping and invite-code migrations applied,
 * driving the repository's own provisionInTransaction.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { AuthIdentity } from "../src/lib/auth/adapter";
import { provisionInTransaction } from "../src/lib/cloudsql/identity-repository";
import { generateInviteCode, hashInviteCode } from "../src/lib/invite-codes";

const sql = (path: string) => readFileSync(new URL(`../cloudsql/${path}`, import.meta.url), "utf8");
const db = new PGlite();
const client = { query: (text: string, params?: unknown[]) => db.query(text, params) } as never;

async function inTransaction<T>(work: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    const result = await work();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

let subjectCounter = 0;
function identity(email: string, provider: "google.com" | "password" | "facebook.com", verified: boolean): AuthIdentity {
  subjectCounter += 1;
  return {
    provider: "firebase",
    subject: `uid-${subjectCounter}`,
    email,
    ownerUserId: null,
    claims: { email_verified: verified, firebase: { sign_in_provider: provider }, name: email.split("@")[0] },
    userMetadata: {},
  };
}
const allowed = (who: AuthIdentity) => ({ email: who.email!.toLowerCase(), verified: who.claims.email_verified === true });
async function makeCode(options: { maxUses?: number; days?: number; boundEmail?: string | null; revoked?: boolean } = {}) {
  const code = generateInviteCode();
  await db.query(
    `INSERT INTO public.invite_codes (code_hash, label, bound_email, max_uses, expires_at, revoked_at)
     VALUES ($1, 'test', $2, $3, now() + make_interval(days => $4::int), CASE WHEN $5::boolean THEN now() END)`,
    [hashInviteCode(code), options.boundEmail ?? null, options.maxUses ?? 1, options.days ?? 14, options.revoked ?? false]
  );
  return hashInviteCode(code);
}
const count = async (text: string, params: unknown[] = []) =>
  Number(((await db.query<{ n: string }>(text, params)).rows[0] as { n: string }).n);
const redeem = (who: AuthIdentity, hash: string) => inTransaction(() => provisionInTransaction(client, who, allowed(who), { inviteCodeHash: hash }));
const signIn = (who: AuthIdentity) => inTransaction(() => provisionInTransaction(client, who, allowed(who), "invite_required"));

test.before(async () => {
  await db.exec(`
    CREATE ROLE papertrend_app;
    CREATE TABLE public.user_profiles (
      id UUID PRIMARY KEY, email TEXT UNIQUE, full_name TEXT, avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'member', workspace_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  `);
  await db.exec(sql("phase4_identity_mapping.sql"));
  await db.exec(sql("20260929_invite_codes.sql"));
});

test("signing in with no account and no code creates nothing", async () => {
  const who = identity("new1@example.edu", "google.com", true);
  assert.deepEqual(await signIn(who), { status: "invite_required" });
  assert.equal(await count("SELECT count(*)::text AS n FROM public.user_profiles WHERE email=$1", ["new1@example.edu"]), 0);
  assert.equal(await count("SELECT count(*)::text AS n FROM public.auth_identity_mappings"), 0);
});

test("a wrong code creates nothing", async () => {
  const who = identity("new2@example.edu", "google.com", true);
  assert.deepEqual(await redeem(who, hashInviteCode(generateInviteCode())), { status: "invalid_code" });
  assert.equal(await count("SELECT count(*)::text AS n FROM public.user_profiles"), 0);
});

test("a valid code creates the account, the mapping and the record, and is spent", async () => {
  const hash = await makeCode();
  const who = identity("New3@Example.edu", "google.com", true);
  const result = await redeem(who, hash);
  assert.equal(result.status, "linked");
  const owner = (result as { ownerUserId: string }).ownerUserId;
  assert.equal(await count("SELECT count(*)::text AS n FROM public.user_profiles WHERE id=$1 AND email='new3@example.edu'", [owner]), 1);
  assert.equal(await count("SELECT count(*)::text AS n FROM public.auth_identity_mappings WHERE owner_user_id=$1 AND external_subject=$2", [owner, who.subject]), 1);
  assert.equal(await count("SELECT count(*)::text AS n FROM public.invite_code_redemptions WHERE owner_user_id=$1", [owner]), 1);
  assert.equal(await count("SELECT use_count::text AS n FROM public.invite_codes WHERE code_hash=$1", [hash]), 1);
  // Signing in again finds the account; nothing more is spent.
  assert.equal((await signIn(who)).status, "linked");
  assert.equal((await redeem(who, hash)).status, "linked", "an existing member is linked, not refused");
  assert.equal(await count("SELECT use_count::text AS n FROM public.invite_codes WHERE code_hash=$1", [hash]), 1);
  assert.deepEqual(await redeem(identity("new4@example.edu", "google.com", true), hash), { status: "invalid_code" });
});

test("a code with several uses admits that many, then no more", async () => {
  const hash = await makeCode({ maxUses: 2 });
  assert.equal((await redeem(identity("a1@example.edu", "google.com", true), hash)).status, "linked");
  assert.equal((await redeem(identity("a2@example.edu", "google.com", true), hash)).status, "linked");
  assert.deepEqual(await redeem(identity("a3@example.edu", "google.com", true), hash), { status: "invalid_code" });
  assert.equal(await count("SELECT use_count::text AS n FROM public.invite_codes WHERE code_hash=$1", [hash]), 2);
});

test("expired and revoked codes are refused", async () => {
  const expired = await makeCode({ days: -1 });
  assert.deepEqual(await redeem(identity("e1@example.edu", "google.com", true), expired), { status: "invalid_code" });
  const revoked = await makeCode({ revoked: true });
  assert.deepEqual(await redeem(identity("r1@example.edu", "google.com", true), revoked), { status: "invalid_code" });
  assert.equal(await count("SELECT count(*)::text AS n FROM public.user_profiles WHERE email IN ('e1@example.edu','r1@example.edu')"), 0);
});

test("a code for one person works only for that person's verified email", async () => {
  const hash = await makeCode({ boundEmail: "named@example.edu", maxUses: 3 });
  assert.deepEqual(await redeem(identity("other@example.edu", "google.com", true), hash), { status: "invalid_code" });
  assert.deepEqual(await redeem(identity("named@example.edu", "facebook.com", false), hash), { status: "invalid_code" }, "an unverified email cannot claim it");
  assert.equal((await redeem(identity("Named@example.edu", "google.com", true), hash)).status, "linked");
});

test("an existing account is linked by verified email without a code, and its code is not spent", async () => {
  await db.query(`INSERT INTO public.user_profiles (id, email, full_name) VALUES (gen_random_uuid(), 'old@example.edu', 'Old')`);
  assert.equal((await signIn(identity("old@example.edu", "google.com", true))).status, "linked");
  await db.query(`INSERT INTO public.user_profiles (id, email, full_name) VALUES (gen_random_uuid(), 'old2@example.edu', 'Old 2')`);
  const hash = await makeCode();
  assert.equal((await redeem(identity("old2@example.edu", "google.com", true), hash)).status, "linked");
  assert.equal(await count("SELECT use_count::text AS n FROM public.invite_codes WHERE code_hash=$1", [hash]), 0);
  // An unverified sign-in never joins it.
  assert.deepEqual(await signIn(identity("old@example.edu", "facebook.com", false)), { status: "refused" });
});

test("a recreated login with the same verified email signs in to its account (docs/32, 2.12)", async () => {
  await db.query(`INSERT INTO public.user_profiles (id, email, full_name) VALUES (gen_random_uuid(), 'again@example.edu', 'Again')`);
  const first = identity("again@example.edu", "password", true);
  const linked = await signIn(first);
  assert.equal(linked.status, "linked");
  const owner = (linked as { ownerUserId: string }).ownerUserId;

  // The Firebase login is deleted and made again: a new subject, the same verified email.
  const recreated = identity("again@example.edu", "password", true);
  assert.deepEqual(await signIn(recreated), { status: "linked", ownerUserId: owner, email: "again@example.edu" });
  const mappings = await db.query<{ external_subject: string }>(
    "SELECT external_subject FROM public.auth_identity_mappings WHERE owner_user_id=$1", [owner]
  );
  assert.deepEqual(mappings.rows.map((row) => row.external_subject), [recreated.subject], "one login per account, the new one");
  // The recreated login is found directly from now on.
  assert.equal((await signIn(recreated)).status, "linked");

  // An unverified login with that email still cannot take the account over.
  assert.deepEqual(await signIn(identity("again@example.edu", "password", false)), { status: "refused" });
  assert.equal(await count("SELECT count(*)::text AS n FROM public.auth_identity_mappings WHERE owner_user_id=$1 AND external_subject=$2", [owner, recreated.subject]), 1);
  // Nobody else's mapping was touched.
  assert.equal(await count("SELECT count(*)::text AS n FROM public.auth_identity_mappings m JOIN public.user_profiles p ON p.id = m.owner_user_id WHERE p.email='old@example.edu'"), 1);
});

test("mapping keys stay immutable, and the database refuses a use beyond max_uses", async () => {
  await assert.rejects(db.query("UPDATE public.auth_identity_mappings SET external_subject = 'changed'"), /immutable/);
  const hash = await makeCode();
  await assert.rejects(db.query("UPDATE public.invite_codes SET use_count = 2 WHERE code_hash=$1", [hash]));
});
